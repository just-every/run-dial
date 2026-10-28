import {useState} from 'react';
import {Button} from '../../../app/ui/primitives';
import {AnswerFields} from './answer-fields';
import {routingRequest,formPath} from './transport';
import type {Answers,Outcome,Question} from './model';
export function RulePreview({id,questions,disabled}:{id:string;questions:Question[];disabled:boolean}) {
 const [answers,setAnswers]=useState<Answers>({}),[result,setResult]=useState<{ruleId:string|null;ruleLabel:string;outcome:Outcome}>(),[error,setError]=useState(''),[working,setWorking]=useState(false);
 return <section className="grid gap-4 rounded-xl border border-line p-5"><h3 className="text-lg font-semibold">Test your rules</h3><p className="text-soft">Preview uses saved rules and does not record a submission.</p><AnswerFields preview questions={questions} answers={answers} onChange={setAnswers}/><Button type="button" variant="secondary" disabled={disabled||working} onClick={()=>{setWorking(true);setError('');void routingRequest<typeof result>(`${formPath}/${id}/preview`,'POST',{answers}).then(setResult).catch(e=>setError(e.message)).finally(()=>setWorking(false));}}>{working?'Checking…':'Preview outcome'}</Button>{error?<p role="alert">{error}</p>:null}{result?<div role="status" className="grid gap-2 rounded-xl bg-wash p-4"><strong>{result.ruleLabel||'Fallback'}</strong><p>{result.outcome.kind==='message'?result.outcome.message:result.outcome.kind==='url'?`Open ${result.outcome.url}`:`Offer event ${result.outcome.eventTypeId}`}</p></div>:null}</section>;
}
