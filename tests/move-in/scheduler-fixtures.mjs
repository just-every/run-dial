const address=name=>[name,'example.test'].join('@');
export const invitee=address('synthetic-dial-601');
const capturedAt='2027-01-01T00:00:00.000Z';
const csv=rows=>rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n';
const file=(name,value)=>({name,bytes:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
export function genericFiles(calendar=false){
 const answers=JSON.stringify([{question:'Project goal',answer:'A new, useful\nworkspace',position:0,legacy_rule:{priority:'old-provider-only'}}]);
 const files=[file('source.json',{version:1,accountId:'synthetic-dial-600',name:'Example workspace',handle:'example-workspace',timezone:'UTC',capturedAt,legacy_brand:'old-theme'}),
 file('event-types.csv',csv([['id','title','slug','description','duration','color','listed','location_type','location_value','payment_rule'],['consultation','Project consultation','consultation','A project, with detail',30,'#176b5a','true','in_person','Main office','old-provider-only']])),
 file('availability.csv',csv([['event_type_id','kind','day','start','end','priority'],['consultation','weekly','tuesday','09:00','17:00','old-provider-only']]))];
 if(calendar){
  const escaped=answers.replaceAll('\\','\\\\').replaceAll(';','\\;').replaceAll(',','\\,');
  files.push(file('bookings.ics',['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-Dial synthetic fixture-','BEGIN:VEVENT','UID:synthetic-dial-602','X-DIAL-EVENT-TYPE-ID:consultation','SUMMARY:Project with Ada','DTSTART:20270105T150000Z','DTEND:20270105T153000Z','CREATED:20261201T100000Z',`ATTENDEE;CN="Ada Example":mailto:${invitee}`,'X-DIAL-INVITEE-TIMEZONE:UTC','X-DIAL-LOCATION-TYPE:in_person','LOCATION:Main office','STATUS:CONFIRMED',`X-DIAL-ANSWERS:${escaped}`,'X-OLD-REMINDER:old-provider-only','END:VEVENT','END:VCALENDAR',''].join('\r\n')));
 }else files.push(file('bookings.csv',csv([['id','event_type_id','title','start','end','created_at','name','email','timezone','location_type','location_value','status','answers','sms_rule'],['synthetic-dial-602','consultation','Project with Ada','2027-01-05T15:00:00.000Z','2027-01-05T15:30:00.000Z','2026-12-01T10:00:00.000Z','Ada Example',invitee,'UTC','in_person','Main office','confirmed',answers,'old-provider-only']])));
 return files;
}
export function calCapture(){
 return {dialCapture:1,provider:'calcom',capturedAt,
 user:{id:600,name:'Example workspace',username:'example-workspace',timeZone:'UTC',theme:{dark:'old-provider-only'}},
 schedules:[{id:603,ownerId:600,name:'Work week',timeZone:'UTC',isDefault:true,availability:[{days:['Tuesday'],startTime:'09:00',endTime:'17:00',priority:'old-provider-only'}],overrides:[]}],
 eventTypes:[{id:604,ownerId:600,title:'Project consultation',slug:'consultation',description:'A project, with detail',lengthInMinutes:30,hidden:false,bookingFields:[{slug:'goal',type:'textarea',label:'Project goal',required:true,hidden:false,options:[],isDefault:false}],locations:[{type:'address',address:'Main office'}],scheduleId:603,color:{lightThemeHex:'#176b5a',darkThemeHex:'#123456'},payment:{amount:50},users:[{id:600}]}],
 bookings:[{uid:'synthetic-dial-602',eventTypeId:604,title:'Project with Ada',status:'accepted',start:'2027-01-05T15:00:00.000Z',end:'2027-01-05T15:30:00.000Z',createdAt:'2026-12-01T10:00:00.000Z',location:'Main office',hosts:[{id:600}],attendees:[{name:'Ada Example',email:invitee,timeZone:'UTC',phoneNumber:'old-provider-only'}],guests:[],bookingFieldsResponses:{goal:'A new, useful\nworkspace',privateExtra:'old-provider-only'},sms:{reminder:'old-provider-only'}}]};
}
export function savvyCapture(){
 const host=address('synthetic-dial-600'),organizer={id:'synthetic-dial-600',display_name:'Example workspace',email:host,is_organizer:true,time_zone:'UTC',fields:[]};
 return {dialCapture:1,provider:'savvycal',capturedAt,user:{id:'synthetic_dial_600',display_name:'Example workspace',email:host,time_zone:'UTC',avatar:{url:'https://example.test/avatar.png'}},schedules:[],
 eventTypes:[{id:'synthetic-dial-604',name:'Project consultation',slug:'consultation',description:'Project consultation',default_duration:30,durations:[30],state:'active',fields:[{id:'synthetic-dial-605',type:'long_text',label:'Project goal',is_required:true,options:[]}],private_name:'old-provider-only'}],
 bookings:[{id:'synthetic-dial-602',link:{id:'synthetic-dial-604',name:'Project consultation',slug:'consultation'},start_at:'2027-01-05T15:00:00.000Z',end_at:'2027-01-05T15:30:00.000Z',created_at:'2026-12-01T10:00:00.000Z',state:'confirmed',organizer,attendees:[organizer,{id:'synthetic-dial-601',display_name:'Ada Example',email:invitee,time_zone:'UTC',is_organizer:false,fields:[{label:'Project goal',value:'A new, useful\nworkspace'}],phone_number:'old-provider-only'}],location:'Main office',buffer_before:0,buffer_after:0,summary:'Project with Ada',is_group_session:false,maximum_group_size:1,poll:null,url:'https://savvycal.com/events/synthetic-dial-602',payment:{amount_total:5000}}]};
}
export const captureFiles=capture=>[file(`${capture.provider}-capture.json`,capture)];
export const schedulerCases=()=>[
 {name:'Cal.com',files:captureFiles(calCapture()),losses:['theme.dark','availability[0].priority','color.darkThemeHex','payment.amount','attendees[0].phoneNumber','bookingFieldsResponses.privateExtra','sms.reminder']},
 {name:'SavvyCal',files:captureFiles(savvyCapture()),losses:['avatar.url','private_name','attendees[1].phone_number','payment.amount_total','url','availability','locations','hostTopology']},
 {name:'CSV',files:genericFiles(),losses:['legacy_brand','payment_rule','availability.priority','sms_rule','answers[0].legacy_rule.priority']},
 {name:'calendar',files:genericFiles(true),losses:['legacy_brand','payment_rule','availability.priority','X-OLD-REMINDER','answers[0].legacy_rule.priority']},
];
