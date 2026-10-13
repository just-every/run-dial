import { Worker } from 'node:worker_threads';
const value=input=>{
 if(typeof input==='boolean')return Number(input);
 if(input===null||typeof input==='string'||typeof input==='number'||input instanceof ArrayBuffer||ArrayBuffer.isView(input))return input instanceof ArrayBuffer?new Uint8Array(input):input;
 if(Array.isArray(input)&&input.every(x=>Number.isInteger(x)&&x>=0&&x<=255))return new Uint8Array(input);
 throw new Error(`D1_TYPE_ERROR: Type '${typeof input}' not supported for value '${input}'`);
};
export class D1 {
 constructor(path){this.path=path;this.pending=new Map();this.next=0;this.start();}
 start(){
  this.worker=new Worker(new URL('./sqlite-worker.mjs',import.meta.url),{workerData:{path:this.path}});
  this.worker.on('message',message=>{
   const pending=this.pending.get(message.id);if(!pending)return;
   if(message.started){pending.timer=setTimeout(()=>{void this.worker.terminate();this.fail(new Error('D1_ERROR: query timed out: SQLITE_INTERRUPT'));},30000);return;}
   clearTimeout(pending.timer);this.pending.delete(message.id);message.error?pending.reject(new Error(message.error)):pending.resolve(message.result);
  });
  this.worker.on('error',cause=>this.fail(cause));this.worker.on('exit',code=>{this.worker=null;if(this.pending.size)this.fail(new Error('D1_ERROR: database worker stopped'));});
 }
 fail(cause){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(cause);}this.pending.clear();}
 call(operation,statements,sql){if(!this.worker)this.start();const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,operation,statements,sql});});}
 prepare(sql){return new Statement(this,sql);}
 async batch(statements){if(statements.some(item=>item.db!==this))throw new Error('Foreign statement');const results=await this.call('batch',statements.map(({sql,args})=>({sql,args})));return results.map(({columns,rawResults,...result})=>result);}
 exec(sql){return this.call('exec',undefined,sql);}
 async close(){this.fail(new Error('D1 database closed'));await this.worker?.terminate();this.worker=null;}
}
class Statement {
 constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.db,this.sql,args.map(value));}
 execute(){return this.db.call('statement',[{sql:this.sql,args:this.args}]);}
 async all(){const {columns,rawResults,...result}=await this.execute();return result;}
 run(){return this.all();}
 async first(column){const first=(await this.execute()).results[0];if(!first)return null;if(column!==undefined){if(!Object.hasOwn(first,column))throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);return first[column];}return first;}
 async raw({columnNames=false}={}){const {rawResults,columns}=await this.execute();return columnNames?[columns,...rawResults]:rawResults;}
}
