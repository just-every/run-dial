import { Input,Select } from '../../../app/ui/primitives';
import type { Answers,Question } from './model';
export function AnswerFields({questions,answers,onChange,preview=false}:{questions:Question[];answers:Answers;onChange:(answers:Answers)=>void;preview?:boolean}) {
 return <>{questions.filter(q=>preview||q.kind!=='hidden').map(q=>{const value=answers[q.key]??'';const set=(next:string|string[])=>onChange({...answers,[q.key]:next});
 if(q.kind==='multiple_choice')return <fieldset key={q.key} className="grid gap-2"><legend className="mb-2 font-semibold">{q.label}{q.required?' *':''}</legend>{q.options?.map(option=><label className="flex items-center gap-3" key={option}><input type="checkbox" checked={Array.isArray(value)&&value.includes(option)} onChange={e=>set(e.target.checked?[...(Array.isArray(value)?value:[]),option]:(Array.isArray(value)?value:[]).filter(v=>v!==option))}/>{option}</label>)}</fieldset>;
 if(['single_choice','dropdown'].includes(q.kind))return <label key={q.key} className="grid gap-2">{q.label}{q.required?' *':''}<Select required={q.required} value={String(value)} onChange={e=>set(e.target.value)}><option value="">Choose an answer</option>{q.options?.map(option=><option key={option} value={option}>{option}</option>)}</Select></label>;
 return <label key={q.key} className="grid gap-2">{q.label||q.key}{q.required?' *':''}{preview&&q.kind==='hidden'?' (hidden parameter)':''}<Input type={q.kind==='phone'?'tel':q.kind==='company_size'?'number':['number','email'].includes(q.kind)?q.kind:'text'} required={q.required} value={String(value)} onChange={e=>set(e.target.value)}/></label>;
 })}</>;
}
