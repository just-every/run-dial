import type { Condition, RouteMatch, RoutingAnswers, RoutingFormInput } from "./types";

function matches(condition: Condition, answers: RoutingAnswers): boolean {
  if ("mode" in condition) {
    return condition.mode === "and"
      ? condition.conditions.every(child => matches(child, answers))
      : condition.conditions.some(child => matches(child, answers));
  }
  const answer = Object.hasOwn(answers, condition.question) ? answers[condition.question] : undefined;
  if (answer === undefined || answer === "" || (Array.isArray(answer) && answer.length === 0)) return false;
  const values = Array.isArray(answer) ? answer : [answer];
  const expected = Array.isArray(condition.value) ? condition.value : [String(condition.value)];
  switch (condition.operator) {
    case "equals":
      return values.length === expected.length && values.every(value => expected.includes(value));
    case "contains":
      return expected.every(value => answer.includes(value));
    case "in":
      return values.some(value => expected.includes(value));
    case "greater_than":
      return typeof answer === "string" && Number.isFinite(Number(answer)) && Number(answer) > Number(condition.value);
    case "range":
      return typeof answer === "string" && Number.isFinite(Number(answer)) && condition.max !== undefined
        && Number(answer) >= Number(condition.value) && Number(answer) <= condition.max;
  }
}

/** Both preview and public submission pass validated, normalized answers here. */
export function matchRoute(form: Pick<RoutingFormInput, "rules" | "fallback">, answers: RoutingAnswers): RouteMatch {
  for (const rule of form.rules) {
    if (matches(rule.when, answers)) return { ruleId: rule.id, ruleLabel: rule.label, outcome: rule.outcome };
  }
  return { ruleId: null, ruleLabel: "Fallback", outcome: form.fallback };
}
