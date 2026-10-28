import {useEffect,useState} from 'react';
import {useDocumentData} from '../../../app/document-data';
import {useHydrated} from '../../../app/use-hydrated';
import {publicApi,errorMessage} from '../../../api/client';
import {Card,Button,noticeClassName} from '../../../app/ui/primitives';
import {PublicTheme,PublicHeader,PublicFooter} from '../../public-booking';
import {AnswerFields} from './answer-fields';
import type {Answers,Question} from './model';
type PublicForm = {form:{title:string;questions:Question[]};token:string;expiresAt:string};
type Result = {kind:'event'|'url';url:string}|{kind:'message';message:string};
export function RoutingPage({slug,embedded=false}:{slug:string;embedded?:boolean}) {
 const initial=useDocumentData<PublicForm>();const hydrated=useHydrated();
 const [answers,setAnswers]=useState<Answers>({});
 useEffect(()=>{if(!initial)return;const query=new URLSearchParams(window.location.search);setAnswers(current=>({...Object.fromEntries(initial.form.questions.filter(q=>q.kind==='hidden').map(q=>[q.key,query.get(q.parameter??q.key)??''])),...current}));},[initial]);
 const [result,setResult]=useState<Result>(),[error,setError]=useState(''),[working,setWorking]=useState(false);
 async function submit(){if(!initial||working)return;setWorking(true);setError('');try{const attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','source'].flatMap(key=>{const value=new URLSearchParams(window.location.search).get(key);return value?[[key,value]]:[];}));
 // Use the public client's credential policy, including isolated hosted demos.
 const response=await publicApi.api.public.routing[':slug'].$post({param:{slug},json:{token:initial.token,answers,attribution}});
 if(!response.ok)throw new Error(await errorMessage(response));const next=await response.json() as Result;setResult(next);if(next.kind!=='message'){const destination=new URL(next.url,window.location.origin);if(embedded&&next.kind==='event'&&destination.origin===window.location.origin&&destination.pathname.startsWith('/book/')){destination.pathname=destination.pathname.replace(/^\/book\//,'/embed/');const parent=new URLSearchParams(window.location.search).get('parent');if(parent)destination.searchParams.set('parent',parent);}window.location.assign(destination.href);}
 }catch(e){setError(e instanceof Error?e.message:'Your answers could not be submitted.');}finally{setWorking(false);}}
 return <PublicTheme>{!embedded?<PublicHeader/>:null}<main className="mx-auto grid w-full max-w-2xl min-w-0 gap-6 px-5 py-8 text-[15px]"><Card className="grid gap-5 p-6 sm:p-8">{!initial?<p role="alert">This routing form is unavailable.</p>:<><h1 className="text-3xl font-semibold">{initial.form.title}</h1>{result?.kind==='message'?<p role="status" className="whitespace-pre-wrap">{result.message}</p>:<form className="grid gap-5" onSubmit={e=>{e.preventDefault();void submit();}}><p className="text-soft">Answer a few questions to find the right next step.</p><AnswerFields questions={initial.form.questions} answers={answers} onChange={setAnswers}/>{error?<p role="alert" className={noticeClassName('error')}>{error}</p>:null}<p className="text-[13px] text-soft">Your answers are shared with the host to route your request. <a className="underline" href="/privacy">Privacy</a></p><Button type="submit" disabled={!hydrated||working}>{working?'Submitting…':'Continue'}</Button>{result?<a className="underline" href={result.url}>Continue to your destination</a>:null}</form>}</>}</Card></main>{!embedded?<PublicFooter/>:null}</PublicTheme>;
}
