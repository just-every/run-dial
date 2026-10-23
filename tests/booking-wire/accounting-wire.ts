/** Contract-shaped QuickBooks HTTP double. Product code never sees these tables. */
export const accountingHosts=['oauth.platform.intuit.com','quickbooks.api.intuit.com'];
export async function accountingWire(db:D1Database,url:URL,method:string,init:RequestInit){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS wire_accounting_objects(id TEXT PRIMARY KEY,kind TEXT,payload TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS wire_accounting_requests(id TEXT PRIMARY KEY,body TEXT,response TEXT)'),
  ]);
  const control=async(name:string)=>(await db.prepare('SELECT value FROM wire_controls WHERE name=?').bind(name).first<{value:number}>())?.value;
  if(url.hostname==='oauth.platform.intuit.com'){
    const form=new URLSearchParams(String(init.body));
    if(await control('accounting-token-refused'))return Response.json({error:'invalid_grant'},{status:400});
    if(!new Headers(init.headers).get('authorization')?.startsWith('Basic ')||!['authorization_code','refresh_token'].includes(form.get('grant_type')??''))throw Error('invalid synthetic accounting exchange');
    return Response.json({access_token:'synthetic-dial-100',refresh_token:'synthetic-dial-101',expires_in:3600});
  }
  if(new Headers(init.headers).get('authorization')!=='Bearer synthetic-dial-100'||await control('accounting-revoked'))return Response.json({Fault:{type:'AuthenticationFault'}},{status:401});
  const body=init.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined;
  // Captured API bodies deliberately omit credentials.
  await db.prepare('INSERT INTO wire_calls(url,method,body,headers) VALUES(?,?,?,?)').bind(url.toString(),method,body?JSON.stringify(body):null,'{}').run();
  const path=url.pathname.split('/').at(-1);
  if(path==='preferences')return Response.json({Preferences:{SalesFormsPrefs:{CustomTxnNumbers:true}}});
  if(path==='query'){
    const query=url.searchParams.get('query')??'';
    if(query.startsWith('select * from Account'))return Response.json({QueryResponse:{Account:[{Id:'synthetic-dial-102',Name:'Coaching income'}]}});
    const kind=query.includes('from SalesReceipt')?'SalesReceipt':'Item',field=kind==='Item'?'Name':'DocNumber',match=query.match(/= '([^']+)'/u)?.[1];
    const rows=(await db.prepare('SELECT payload FROM wire_accounting_objects WHERE kind=?').bind(kind).all<{payload:string}>()).results.map(r=>JSON.parse(r.payload)).filter(r=>r[field]===match);
    return Response.json({QueryResponse:{[kind]:rows}});
  }
  if(method==='POST'&&body&&['item','salesreceipt'].includes(path??'')){
    const requestId=url.searchParams.get('requestid');if(!requestId)throw Error('QuickBooks requestid required');
    const cached=await db.prepare('SELECT body,response FROM wire_accounting_requests WHERE id=?').bind(requestId).first<{body:string;response:string}>();
    if(cached){if(cached.body!==JSON.stringify(body))return Response.json({Fault:{type:'ValidationFault'}},{status:400});return Response.json(JSON.parse(cached.response));}
    const kind=path==='item'?'Item':'SalesReceipt';
    if(kind==='SalesReceipt'&&(String(body.DocNumber).length>21||!Array.isArray(body.Line)||body.CustomerRef))throw Error('invalid anonymous sales receipt');
    const id=`synthetic-dial-${crypto.randomUUID()}`,payload={Id:id,...body},response={[kind]:payload};
    const inserted=await db.prepare('INSERT OR IGNORE INTO wire_accounting_requests(id,body,response) VALUES(?,?,?)').bind(requestId,JSON.stringify(body),JSON.stringify(response)).run();
    if(!inserted.meta.changes){const duplicate=await db.prepare('SELECT response FROM wire_accounting_requests WHERE id=?').bind(requestId).first<{response:string}>();return Response.json(JSON.parse(duplicate!.response));}
    await db.prepare('INSERT INTO wire_accounting_objects(id,kind,payload) VALUES(?,?,?)').bind(id,kind,JSON.stringify(payload)).run();
    if(kind==='SalesReceipt'&&await control('accounting-response-lost')){await db.prepare("DELETE FROM wire_controls WHERE name='accounting-response-lost'").run();throw Error('synthetic accounting response lost after acceptance');}
    return Response.json(response);
  }throw Error('unimplemented accounting edge '+url.pathname);
}
