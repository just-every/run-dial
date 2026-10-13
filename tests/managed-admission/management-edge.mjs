import { createServer } from 'node:http';
/** The only replaced network edge: a local management protocol peer. */
export async function managementEdge() {
  const state = { allowed: '', denied: false };
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.setHeader('content-security-policy', `frame-ancestors ${state.denied ? "'none'" : state.allowed}`);
    response.end(`<!doctype html><html><body><p>Local management test edge</p><textarea aria-label="Private editor draft"></textarea><script>
const query=new URL(location.href).searchParams,origin=query.get('parentOrigin'),installationId=query.get('installation');let sessionId;
const send=(type,values={})=>parent.postMessage({...values,protocol:'rer-editor',version:1,installationId,type,...(sessionId?{sessionId}:{})},origin);
addEventListener('message',event=>{if(event.origin!==origin||event.source!==parent)return;const message=event.data;if(message.type==='protocol-offer'){sessionId=message.sessionId;send('protocol-accept')}if(message.type==='protocol-connected'||message.type==='editor-visibility')send('interactive-regions',{viewport:{width:innerWidth,height:innerHeight},regions:[{x:8,y:8,width:Math.min(340,innerWidth-16),height:120}]})});
send('ready');
</script></body></html>`);
  });
  await new Promise(done => server.listen(15767, '127.0.0.1', done));
  return { state, origin: 'http://127.0.0.1:15767', close: () => new Promise(done => server.close(done)) };
}
