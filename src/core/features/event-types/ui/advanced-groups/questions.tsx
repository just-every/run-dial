import { useState } from "react";
import type { EventQuestionInput } from "../../repository";
import { QuestionsEditor } from "../questions-editor";
import { SaveFailed } from "../../../../app/ui/autosave/saved-state";
import type { EventDetailsSave } from "../event-page-context";
export function Questions({ details }: { details: EventDetailsSave }) {
  const [activeQuestion, setActiveQuestion] = useState<number>();
  function update(questions: EventQuestionInput[], choice: boolean) {
    setActiveQuestion(questions.findIndex((question, index) => JSON.stringify(question) !== JSON.stringify(details.values.questions[index])));
    const redirect = details.values.postBookingRedirect;
    if (redirect) details.type("postBookingRedirect", { ...redirect, fields: redirect.fields.filter(field => !field.startsWith("answer.") || questions.some(question => question.key === field.slice(7) && !question.private)) });
    if (choice) details.choose("questions", questions); else details.type("questions", questions);
  }
  return <div onBlur={entry => { if (!entry.currentTarget.contains(entry.relatedTarget)) details.leave("questions"); } } className="grid gap-3"><QuestionsEditor compact savedState={details.state("questions")} activeQuestion={activeQuestion} questions={details.values.questions} onChange={questions => update(questions, false)} onChoose={questions => update(questions, true)} />{details.validation("questions") ? <p className="autosave-failed" role="alert" tabIndex={-1} data-autosave-attention>{details.validation("questions")}</p> : <SaveFailed id="questions-save-failed" state={details.state("questions")} what="the questions" onRetry={details.retry} />}</div>;
}
