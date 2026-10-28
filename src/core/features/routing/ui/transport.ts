import { workspaceFetch } from '../../../app/workspace-reads';
import { errorMessage } from '../../../api/client';
export async function routingRequest<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const response = await workspaceFetch(path,{method,credentials:'same-origin',...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  if(!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}
export const formPath = '/api/app/routing-forms';
