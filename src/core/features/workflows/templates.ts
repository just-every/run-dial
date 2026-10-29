import { invalidTemplateVariables, renderCorrespondenceTemplate } from "../../shared/correspondence";
import type { BookingCorrespondence } from "../delivery";

type Template={subject:string;text:string;action:string;trigger?:string};
/** Outbound previews and sends share validation; a host message never gains invitee management authority. */
export function workflowTemplateErrors(rule:Template,questions:readonly {key?:string;private?:boolean}[]) {
 if(rule.trigger==="routing-without-booking")return [...new Set([...rule.subject.matchAll(/\{([^{}]*)\}|[{}]/gu),...rule.text.matchAll(/\{([^{}]*)\}|[{}]/gu)].map(match=>match[1]??match[0]))];
 const keys=questions.flatMap(question=>!question.private&&question.key?[question.key]:[]);
 const invalid=new Set([...invalidTemplateVariables(rule.subject,keys),...invalidTemplateVariables(rule.text,keys)]);
 if(rule.action!=="email-invitee"&&/\{manage link\}/u.test(rule.subject+rule.text))invalid.add("manage link");
 return [...invalid];
}
export function workflowMessage(rule:Template,data:BookingCorrespondence,manageUrl:string) {
 const invalid=workflowTemplateErrors(rule,data.questions);
 if(invalid.length)throw new TypeError(`Unavailable workflow variable: ${invalid.join(", ")}`);
 const keys=data.questions.filter(question=>!question.private).map(question=>question.key);
 const values={...data.values,"manage link":manageUrl};
 return {subject:renderCorrespondenceTemplate(rule.subject,values,keys,true),text:renderCorrespondenceTemplate(rule.text,values,keys)};
}
