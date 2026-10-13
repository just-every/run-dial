import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
export async function checkBoundary(root, { engine='node', cacheContract }={}) {
 const ts=await import(pathToFileURL(createRequire(join(root,'package.json')).resolve('typescript'))), failures=[];
 async function walk(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,item.name);if(item.isDirectory()){await walk(path);continue;}if(!/\.[cm]?[jt]sx?$/.test(item.name))continue;
   const name=relative(root,path),tree=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true);
   const cache=cacheContract==='lamp-retained-v1'&&/(?:^|\/)platform\/blobs\/snapshot-cache\.ts$/.test(name);
   const bindings=/(?:^|\/)platform\/bindings\.server\.ts$/.test(name);
   const fail=api=>failures.push({path:name,api}),localNames=new Set();
   function names(node){if((ts.isVariableDeclaration(node)||ts.isFunctionDeclaration(node)||ts.isImportSpecifier(node))&&node.name&&ts.isIdentifier(node.name))localNames.add(node.name.text);ts.forEachChild(node,names);}names(tree);
   function visit(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
     const module=node.moduleSpecifier.text;
     if(module.startsWith('cloudflare:')){
      const imports=node.importClause?.namedBindings;
      const allowed=module==='cloudflare:workers'&&imports&&ts.isNamedImports(imports)&&imports.elements.every(element=>(bindings&&(element.propertyName??element.name).text==='env')||(cache&&(element.propertyName??element.name).text==='DurableObject'));
      if(!allowed)fail('Cloudflare import outside binding/cache contract');
     }
    }
    if(ts.isCallExpression(node)&&node.arguments.some(arg=>ts.isStringLiteral(arg)&&arg.text.startsWith('cloudflare:')))fail('Dynamic Cloudflare import');
    if(ts.isIdentifier(node)&&['WebSocketPair','HTMLRewriter','passThroughOnException','timingSafeEqual'].includes(node.text))fail(node.text);
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='email'&&!localNames.has('email'))fail('email()');
    if(ts.isPropertyAccessExpression(node)&&((node.expression.getText(tree)==='caches'&&node.name.text==='default')||(node.expression.getText(tree)==='request'&&node.name.text==='cf')))fail(node.getText(tree));
    if(ts.isElementAccessExpression(node)&&ts.isStringLiteral(node.argumentExpression)&&((node.expression.getText(tree)==='caches'&&node.argumentExpression.text==='default')||(node.expression.getText(tree)==='request'&&node.argumentExpression.text==='cf')))fail(node.getText(tree));
    if(ts.isHeritageClause(node)&&node.token===ts.SyntaxKind.ExtendsKeyword&&node.types.some(type=>/DurableObject/.test(type.expression.getText(tree)))&&!cache)fail('New Durable Object');
    ts.forEachChild(node,visit);
   }
   visit(tree);
  }
 }
 await walk(join(root,'src'));
 if(failures.length){const cause=new Error('Container import boundary failed');cause.failures=failures;throw cause;}
 return {engine,ok:true};
}
