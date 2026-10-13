import { sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts';
import type { Json } from '../../../../modules/import-kit/src/types.ts';
export type Row=Record<string,string|number|null>;
export type NativeValue={tables:Record<string,Row[]>};
export type Outcome='imported'|'changed'|'skipped'|'rejected';
export type Accounting={kind:'profile'|'eventTypes'|'questions'|'locations'|'availability'|'overrides'|'settings'|'bookings';sourceId:string;name:string;outcome:Outcome;reason:string;startAt?:string;bookingOutcome?:'toImport'|'past'|'cancelled'|'severalInvitees'|'skippedEvent'|'overlapping'|'invalid'|'movedAtSource'};
export type Choices={skipEvents?:string[];zone?:string;skipAvailability?:string[];locations?:Record<string,{type:'google_meet'|'fixed_link'|'phone'|'in_person';value:string;label:string}>};
export type Snapshot={profile:Row|null;slugs:string[];busy:Array<{id:string;start:string;end:string}>;existing:Set<string>;events:Map<string,Row>};
export function stableId(key:string){const hex=sha256(key).slice(0,32);let n=BigInt(`0x${hex}`);const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let out='';for(let i=0;i<26;i++){out=alphabet[Number(n&31n)]+out;n>>=5n;}return out;}
export function json(value:unknown):Json{return JSON.parse(JSON.stringify(value)) as Json;}
export function validZone(zone:string){return zone==='UTC'||Intl.supportedValuesOf('timeZone').includes(zone);}
export function hostDate(instant:string,zone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));}
export function safeText(value:unknown,max:number,label:string){if(typeof value!=='string'||value.length>max)throw new Error(`${label} exceeds ${max} characters or is missing.`);return value;}
