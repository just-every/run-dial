import http from 'node:http';
import net from 'node:net';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { refuse } from './errors.mjs';
import { loopback } from './parse.mjs';
import { fontResponseHeaders } from './font-cache.mjs';

// The public listener observes transport lifetime without buffering or replacing
// application responses. Preserve Host, Origin, cookies, status and streaming.
// Each request opens its own loopback connection: a pooled keep-alive socket
// that the runtime has already dropped would otherwise fail a fresh request.
// In door mode (`door`: {host, header, secret}) it answers only requests whose
// Host is its own `<name>.localhost:<port>` (or a subdomain) and that carry the
// per-start secret the front door adds; cookies are not scoped by port, so
// anything else could bring another site's cookies here.
// Vite's /@fs/<absolute path> answers only a request holding the checkout's dev
// key (devKey: the key gate's header or cookie); anything else gets 404, so
// Vite's refusal page, which lists the serving allow list, never answers it: a
// 403 carrying that page for any other path (a checkout-root file) is turned
// into the same 404.
// A Host that is neither loopback, a `*.localhost` name nor the configured
// origin's (origin) gets a plain 421 here: the application would refuse it
// anyway, and an auth check that throws on it must not answer with a crash page.
export async function trafficProxy({host,port,target,activity,door,devKey,origin}) {
 const probe=randomUUID(),sockets=new Set(),keyed=keyHolder(devKey),configured=origin?new URL(origin).host:null;
 const server=http.createServer((req,res)=>{
  if(door&&!doorAdmits(req,door)){req.resume();res.writeHead(403,{'content-type':'text/plain; charset=utf-8'});res.end('This checkout answers only through its front door.');return;}
  if(!hostAdmits(req,configured)){req.resume();res.writeHead(421,{'content-type':'text/plain; charset=utf-8'});res.end('This local server answers only its own host.');return;}
  if(!publicPath(req.url)||fsPath(req.url)&&!keyed(req)){req.resume();notFound(res);return;}
  const internal=req.headers['x-rer-probe']===probe;delete req.headers['x-rer-probe'];
  const finish=internal?()=>{}:activity.begin();
  let requestEnded=req.complete,responseEnded=false;
  const completed=()=>{if(requestEnded&&responseEnded)finish();};
  req.once('end',()=>{requestEnded=true;completed();});req.once('aborted',finish);
  res.once('close',()=>{responseEnded=true;if(req.destroyed)finish();else completed();});res.once('finish',()=>{responseEnded=true;completed();});
  const upstream=http.request({host:'127.0.0.1',port:target,path:req.url,method:req.method,headers:req.headers,agent:false},reply=>{
   // Vite answers a path outside its serving allow list with a 403 page that lists the
   // allow list (checkout and home paths); a request without the dev key gets 404 instead.
   // Any other 403 is the application's own and passes through.
   if(reply.statusCode===403&&!keyed(req)){
    const parts=[];
    reply.on('data',chunk=>parts.push(chunk));
    reply.once('end',()=>{
     const body=Buffer.concat(parts);
     if(body.includes(restrictedPage)){notFound(res);return;}
     res.writeHead(reply.statusCode,fontResponseHeaders(req.url,reply.statusCode,reply.rawHeaders,req.headers));res.end(body);
    });
    reply.once('error',()=>res.destroy());
    return;
   }
   res.writeHead(reply.statusCode,fontResponseHeaders(req.url,reply.statusCode,reply.rawHeaders,req.headers));reply.pipe(res);
  });
  req.once('aborted',()=>upstream.destroy());res.once('close',()=>upstream.destroy());
  upstream.on('error',()=>{if(!res.headersSent)notFound(res);else res.destroy();});req.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(req,socket,head)=>{
  if(door&&!doorAdmits(req,door)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
  if(!hostAdmits(req,configured)){socket.end('HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
  if(!publicPath(req.url)||fsPath(req.url)&&!keyed(req)){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
  const hmr=String(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim()).includes('vite-hmr');
  const upstream=net.connect(target,'127.0.0.1',()=>{
   upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((lines,value,i)=>i%2?lines:lines+value+': '+req.rawHeaders[i+1]+'\r\n','')}\r\n`);
   if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
  });
  if(!hmr){
   const observeSafely=observer=>chunk=>{try{observer(chunk);}catch{socket.destroy();upstream.destroy();}};
   const finish=activity.begin(),observe=observeSafely(frameObserver(()=>activity.touch())),replyFrames=observeSafely(frameObserver(()=>activity.touch()));
   let handshake=Buffer.alloc(0),upgraded=false;
   if(head.length)observe(head);socket.on('data',observe);socket.once('close',finish);
   upstream.on('data',chunk=>{
    if(upgraded){replyFrames(chunk);return;}
    handshake=Buffer.concat([handshake,chunk]);const end=handshake.indexOf('\r\n\r\n');
    if(end<0){if(handshake.length>65536)upstream.destroy();return;}
    upgraded=/^HTTP\/1\.[01] 101 /.test(handshake.toString('latin1',0,end));
    if(upgraded)replyFrames(handshake.subarray(end+4));else finish();handshake=Buffer.alloc(0);
   });
  }
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
 catch(error){
  if(['EADDRINUSE','EACCES'].includes(error.code))throw refuse(`Requested port ${port} is unavailable. Stop its owner or choose an explicit free port; rer does not drift.`);
  throw error;
 }
 return {probe,port:server.address().port,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function doorAdmits(req,door){
 const host=String(req.headers.host??'').toLowerCase(),given=Buffer.from(String(req.headers[door.header]??'')),secret=Buffer.from(door.secret);
 // The secret never reaches the application.
 delete req.headers[door.header];
 for(let i=req.rawHeaders.length-2;i>=0;i-=2)if(req.rawHeaders[i].toLowerCase()===door.header)req.rawHeaders.splice(i,2);
 return (host===door.host||host.endsWith('.'+door.host))&&given.length===secret.length&&timingSafeEqual(given,secret);
}
function hostAdmits(req,configured){
 const host=req.headers.host;
 if(host===undefined)return true;
 let url;try{url=new URL(`http://${host}`);}catch{return false;}
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return false;
 return loopback(url.hostname)||url.host===configured;
}
// The key gate's own credentials (modules/operator-auth/dev-gate.mjs): the
// x-rer-dev-key header, or the browser's rer_dev_gate_<port> cookie.
function keyHolder(key){
 if(!key)return ()=>false;
 const same=(a,b)=>{a=Buffer.from(a);b=Buffer.from(b);return a.length===b.length&&timingSafeEqual(a,b);};
 const cookie=createHmac('sha256',key).update('rer-dev-gate\0cookie').digest('hex');
 return req=>{
  const header=req.headers['x-rer-dev-key'];
  if(header!==undefined)return same(String(header),key);
  return String(req.headers.cookie??'').split(';').map(part=>part.trim()).some(part=>/^rer_dev_gate_\d+=/.test(part)&&same(part.slice(part.indexOf('=')+1),cookie));
 };
}
const restrictedPage=Buffer.from('<h1>403 Restricted</h1>');
function notFound(res){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');}
// The runtime's built-in routes (/cdn-cgi/*: Local Explorer, trigger handlers,
// R2 and platform proxies), the checkout's private files and export archives
// (*.rer and their in-progress .partial files) never answer on the public
// listener; rer's scheduler calls the runtime's internal port. Decode as often as
// a server might and test every segment, so encoded, dotted or backslashed
// spellings of either are refused too (APFS ignores case). The documented
// exports/ folder is refused where Vite serves the checkout (the root and its
// /@fs, /@id prefixes), so an app's own /api/.../exports routes still answer.
const privateSegment=/^(?:cdn-cgi|\.rer|\.seed|\.wrangler|\.git|\.dev\.vars.*|\.env.*|.*\.rer(?:\.[\w-]+\.partial)?)$/i;
export function publicPath(url){
 let path=String(url).split(/[?#]/)[0];
 for(let round=0;round<4;round++){let decoded;try{decoded=decodeURIComponent(path);}catch{return false;}if(decoded===path)break;path=decoded;}
 const segments=path.replace(/\\/g,'/').split('/').map(segment=>segment.trim());
 if(segments.some(segment=>privateSegment.test(segment)))return false;
 const served=posix.normalize('/'+segments.join('/')).split('/').filter(Boolean),exports=segment=>/^exports$/i.test(segment);
 return !exports(served[0])&&!(served[0]?.startsWith('@')&&served.some(exports));
}
// Vite's /@fs/ prefix in any spelling publicPath decodes.
export function fsPath(url){
 let path=String(url).split(/[?#]/)[0];
 for(let round=0;round<4;round++){let decoded;try{decoded=decodeURIComponent(path);}catch{return true;}if(decoded===path)break;path=decoded;}
 return /^@fs$/i.test(posix.normalize('/'+path.replace(/\\/g,'/').split('/').map(segment=>segment.trim()).join('/')).split('/').filter(Boolean)[0]??'');
}
// Count application data frames, not protocol ping/pong or an open control
// socket. Parse lengths incrementally without retaining application payloads.
export function frameObserver(touch) {
 let buffer=Buffer.alloc(0),remaining=0;
 return chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  for(;;){
   if(remaining){const count=Math.min(remaining,buffer.length);remaining-=count;buffer=buffer.subarray(count);if(remaining)return;}
   if(buffer.length<2)return;
   const opcode=buffer[0]&15,masked=Boolean(buffer[1]&128);let length=buffer[1]&127,offset=2;
   if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}
   else if(length===127){if(buffer.length<10)return;const big=buffer.readBigUInt64BE(2);if(big>BigInt(Number.MAX_SAFE_INTEGER))throw Error('WebSocket frame too large');length=Number(big);offset=10;}
   if(masked)offset+=4;if(buffer.length<offset)return;
   if(opcode<=2)touch();buffer=buffer.subarray(offset);remaining=length;
   if(!remaining&&!buffer.length)return;
  }
 };
}
