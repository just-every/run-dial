import { defaultCorrespondenceConfig, renderMailCorrespondence } from "../../shared/correspondence";
import { formatTimeRange, renderBrandedMail } from "../delivery/mail";
import type { BookingRecord } from "./types";

export function requestEmail(b:BookingRecord,hostName:string,manageUrl:string,message:string,reminder=false) {
 const values={"invitee full name":b.inviteeName,"invitee first name":b.inviteeName.trim().split(/\s+/u)[0],"host name":hostName,"event name":b.eventTitle,
  "date and time":formatTimeRange(b.occurrence.startAt,b.occurrence.endAt,b.lockedTimezone??b.inviteeTimezone,true),duration:`${b.durationMinutes} minutes`,
  location:b.locationType==="google_meet"?b.meetingUrl??"Meeting link pending":b.locationValue,"manage link":manageUrl,message,answers:{}};
 const mail=renderMailCorrespondence(defaultCorrespondenceConfig(),reminder?"rescheduleRequestReminder":"rescheduleRequest",values);
 return {...mail,to:b.inviteeEmail,recipientRole:"invitee",manageUrl,changeReason:message,
  html:renderBrandedMail({businessName:hostName,heading:mail.subject,paragraphs:[mail.text],actions:[{label:"Manage booking",href:manageUrl}]})};
}
