export type CalendarBooking={fields:Record<string,string>;parameters:Record<string,Record<string,string>>};
const unescape=(value:string)=>value.replace(/\\[nN]/gu,'\n').replace(/\\([,;\\])/gu,'$1');
/** The documented template uses explicit UTC instants and one invitee. */
export function calendarBookings(text:string):CalendarBooking[]{
 const lines=text.replace(/\r\n[ \t]|\n[ \t]/gu,'').split(/\r?\n/u),bookings:CalendarBooking[]=[];
 let current:CalendarBooking|undefined,calendar=false,ended=false;
 for(const line of lines){
  if(!line)continue;
  if(line==='BEGIN:VCALENDAR'){if(calendar)throw new Error('Nested calendars are not supported.');calendar=true;continue;}
  if(line==='END:VCALENDAR'){ended=true;continue;}
  if(!calendar||ended)throw new Error('Choose a complete VCALENDAR file.');
  if(line==='BEGIN:VEVENT'){if(current)throw new Error('Nested events are not supported.');current={fields:{},parameters:{}};continue;}
  if(line==='END:VEVENT'){if(!current)throw new Error('Unexpected end of calendar event.');bookings.push(current);current=undefined;continue;}
  if(!current){if(!/^(?:VERSION|PRODID|CALSCALE|METHOD):/u.test(line))throw new Error('Use the documented calendar template; calendar extensions are not supported.');continue;}
  const match=/^([A-Z0-9-]+)((?:;[^:]+)*):(.*)$/u.exec(line);if(!match)throw new Error('Invalid calendar property.');
  const [,key,rawParameters,value]=match;
  if(key in current.fields)throw new Error(`Duplicate calendar property ${key}. Use one invitee per booking.`);
  if(['RRULE','RDATE','EXDATE','RECURRENCE-ID','BEGIN','END'].includes(key))throw new Error('Expand recurring calendar events into individual bookings before importing.');
  const parameters:Record<string,string>={};
  for(const part of rawParameters.split(';').filter(Boolean)){const at=part.indexOf('=');if(at<1)throw new Error('Invalid calendar parameter.');parameters[part.slice(0,at)]=unescape(part.slice(at+1).replace(/^"(.*)"$/u,'$1'));}
  current.fields[key]=unescape(value);current.parameters[key]=parameters;
 }
 if(!calendar||!ended||current)throw new Error('Choose a complete VCALENDAR file.');
 return bookings;
}
export function calendarInstant(value:string|undefined){
 if(!value||!/^\d{8}T\d{6}Z$/u.test(value))throw new Error('Calendar times must be UTC instants, for example 20270105T150000Z.');
 const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}.000Z`;
 if(!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString()!==iso)throw new Error('Invalid calendar instant.');return iso;
}
