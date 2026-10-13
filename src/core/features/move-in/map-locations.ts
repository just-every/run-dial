import type { SourceData } from './source';
import type { Choices } from './model';

type Location = NonNullable<Choices['locations']>[string];
type SourceLocation = NonNullable<SourceData['event_types'][number]['locations']>[number];

function supportedLocation(source:SourceLocation):Location|undefined{
 if(source.kind==='google_conference')return {type:'google_meet',label:'Google Meet',value:''};
 if(source.kind==='physical')return {type:'in_person',label:'In person',value:source.location??''};
 if(source.kind==='inbound_call')return {type:'phone',label:'Call the host',value:source.phone_number??''};
 if(source.kind==='custom'&&/^https:\/\/[^\s]+$/u.test(source.location??''))return {type:'fixed_link',label:'Meeting link',value:source.location!};
}

export function mapLocations(sources:SourceLocation[],choice:Location|undefined){
 const supported=sources.map(supportedLocation),firstSupported=supported.findIndex(location=>location!==undefined);
 const selected=choice?Math.max(firstSupported,0):firstSupported;
 const location=choice??supported[firstSupported];
 const description=choice?`Owner chose ${choice.type} (${choice.label})${choice.value?`: ${choice.value}`:''}.`:undefined;
 const accounting=sources.map((source,index)=>({
  name:source.kind??'Location',
  outcome:index===selected?(choice?'changed' as const:'imported' as const):'skipped' as const,
  reason:index===selected?description??'First supported location retained.':supported[index]?'Additional location dropped.':location?'Unsupported source location dropped.':'Unsupported location; choose a location in Dial.',
 }));
 // A missing source location is described on the event, never counted as a
 // source row. Likewise a replacement accounts for the source it replaces.
 return {location:location??{type:'in_person',label:'Choose a location',value:''},accounting,
  eventReason:!sources.length?(description??'No source location; draft requires an owner choice.'):undefined};
}
