import { redirectUrlIssue } from "../event-types/redirect-policy.mjs";
/* global URL */
import { z } from "zod";
import { validateRoutingAnswers } from "./answer-validation.mjs";
export { validateRoutingAnswers } from "./answer-validation.mjs";
export const questionKinds = ["text", "email", "phone", "number", "single_choice", "multiple_choice", "dropdown", "company_size", "country", "us_state", "hidden"];
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
    .refine(value => !["__proto__", "prototype", "constructor"].includes(value), "Choose a safe identifier.");
const choices = new Set(["single_choice", "multiple_choice", "dropdown"]);
const numeric = new Set(["number", "company_size"]);
const numberText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const isNumeric = (value) => numberText.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER;
const option = z.string().trim().min(1).max(200);
const questionSchema = z.object({
    key: identifier,
    label: z.string().trim().min(1).max(500),
    kind: z.enum(questionKinds),
    required: z.boolean(),
    options: z.array(option).max(100).optional(),
    parameter: identifier.optional(),
    private: z.boolean().optional(),
}).strict().superRefine((question, context) => {
    if (choices.has(question.kind) && !question.options?.length)
        context.addIssue({ code: "custom", path: ["options"], message: "Choose at least one option." });
    if (!choices.has(question.kind) && question.options?.length)
        context.addIssue({ code: "custom", path: ["options"], message: "Only choice questions can have options." });
    if (question.options && new Set(question.options).size !== question.options.length)
        context.addIssue({ code: "custom", path: ["options"], message: "Options must be unique." });
    if (question.parameter && question.kind !== "hidden")
        context.addIssue({ code: "custom", path: ["parameter"], message: "Only hidden questions can read URL parameters." });
});
const httpsUrl = z.string().max(4096).refine(value => {
    if (!/^https:\/\//i.test(value) || /[\s\\]/u.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
        return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !redirectUrlIssue(value);
    }
    catch {
        return false;
    }
}, "Enter an absolute HTTPS URL without credentials.");
const outcomeSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("event"), eventTypeId: identifier, redirect: z.object({ url: httpsUrl, fields: z.array(z.string().min(1).max(90)).max(125) }).strict().optional() }).strict(),
    z.object({ kind: z.literal("message"), message: z.string().trim().min(1).max(4000) }).strict(),
    z.object({ kind: z.literal("url"), url: httpsUrl }).strict(),
]);
const finiteNumber = z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const leafSchema = z.object({
    question: identifier,
    operator: z.enum(["equals", "contains", "in", "greater_than", "range"]),
    value: z.union([z.string().trim().min(1).max(4000), finiteNumber, z.array(option).min(1).max(100)]),
    max: finiteNumber.optional(),
}).strict().superRefine((condition, context) => {
    if (["greater_than", "range"].includes(condition.operator) && (Array.isArray(condition.value) || !isNumeric(String(condition.value))))
        context.addIssue({ code: "custom", path: ["value"], message: "Use a finite numeric comparison." });
    if (condition.operator === "range" && (condition.max === undefined || condition.max < Number(condition.value)))
        context.addIssue({ code: "custom", path: ["max"], message: "Use an upper bound on or above the lower bound." });
    if (condition.operator !== "range" && condition.max !== undefined)
        context.addIssue({ code: "custom", path: ["max"], message: "Only ranges have an upper bound." });
    if (condition.operator === "in" && !Array.isArray(condition.value))
        context.addIssue({ code: "custom", path: ["value"], message: "Give a list of matching values." });
});
function conditionSchema(depth) {
    if (depth === 0)
        return leafSchema;
    return z.union([leafSchema, z.object({ mode: z.enum(["and", "or"]), conditions: z.array(conditionSchema(depth - 1)).min(1).max(20) }).strict()]);
}
const bookingFields = new Set(["event", "start_time", "end_time", "timezone", "host", "name", "email", "booking_reference", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "source"]);
export const routingFormInput = z.object({
    title: z.string().trim().min(1).max(160),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    published: z.boolean(),
    questions: z.array(questionSchema).max(50),
    rules: z.array(z.object({ id: identifier, label: z.string().trim().min(1).max(160), when: conditionSchema(4), outcome: outcomeSchema }).strict()).max(50),
    fallback: outcomeSchema,
}).strict().superRefine((form, context) => {
    if (form.published && !form.questions.length)
        context.addIssue({ code: "custom", path: ["questions"], message: "Add a question before publishing." });
    const questionByKey = new Map(form.questions.map(question => [question.key, question]));
    if (questionByKey.size !== form.questions.length)
        context.addIssue({ code: "custom", path: ["questions"], message: "Question keys must be unique." });
    if (new Set(form.rules.map(rule => rule.id)).size !== form.rules.length)
        context.addIssue({ code: "custom", path: ["rules"], message: "Rule IDs must be unique." });
    const parameters = form.questions.filter(question => question.kind === "hidden").map(question => question.parameter ?? question.key);
    if (new Set(parameters).size !== parameters.length)
        context.addIssue({ code: "custom", path: ["questions"], message: "Hidden URL parameters must be unique." });
    let conditionCount = 0;
    const visit = (condition, path) => {
        conditionCount++;
        if ("mode" in condition) {
            condition.conditions.forEach((child, index) => visit(child, [...path, "conditions", index]));
            return;
        }
        const question = questionByKey.get(condition.question);
        if (!question) {
            context.addIssue({ code: "custom", path: [...path, "question"], message: "Choose an existing question." });
            return;
        }
        if (["greater_than", "range"].includes(condition.operator) && !numeric.has(question.kind))
            context.addIssue({ code: "custom", path: [...path, "operator"], message: "Numeric comparisons need a numeric question." });
        if (numeric.has(question.kind) && (Array.isArray(condition.value) ? condition.value : [String(condition.value)]).some(value => !isNumeric(value)))
            context.addIssue({ code: "custom", path: [...path, "value"], message: "Use numeric values for a numeric question." });
        if (choices.has(question.kind) && (Array.isArray(condition.value) ? condition.value : [String(condition.value)]).some(value => !question.options?.includes(value)))
            context.addIssue({ code: "custom", path: [...path, "value"], message: "Choose an existing question option." });
        if (shouldNormalize(question, condition)) {
            const values = Array.isArray(condition.value) ? condition.value : [String(condition.value)];
            if (values.some(value => !validateRoutingAnswers([question], { [question.key]: value }).ok))
                context.addIssue({ code: "custom", path: [...path, "value"], message: `Use a valid value for ${question.label}.` });
        }
    };
    const checkOutcome = (outcome, path) => {
        if (outcome.kind !== "event" || !outcome.redirect)
            return;
        const fields = outcome.redirect.fields;
        if (new Set(fields).size !== fields.length)
            context.addIssue({ code: "custom", path: [...path, "redirect", "fields"], message: "Choose distinct redirect fields." });
        fields.forEach((field, index) => {
            const question = field.startsWith("answer.") ? questionByKey.get(field.slice(7)) : undefined;
            if (question?.private || (!question && !bookingFields.has(field)))
                context.addIssue({ code: "custom", path: [...path, "redirect", "fields", index], message: "Choose a named booking field or a non-private question." });
        });
    };
    form.rules.forEach((rule, index) => { visit(rule.when, ["rules", index, "when"]); checkOutcome(rule.outcome, ["rules", index, "outcome"]); });
    if (conditionCount > 500)
        context.addIssue({ code: "custom", path: ["rules"], message: "Use at most 500 conditions across the form." });
    checkOutcome(form.fallback, ["fallback"]);
}).transform(form => {
    const questions = new Map(form.questions.map(question => [question.key, question]));
    const normalize = (condition) => {
        if ("mode" in condition)
            return { ...condition, conditions: condition.conditions.map(normalize) };
        const question = questions.get(condition.question);
        if (!shouldNormalize(question, condition))
            return condition;
        const normalizeValue = (value) => {
            const result = validateRoutingAnswers([question], { [question.key]: value });
            if (!result.ok)
                throw new Error("Invalid routing comparison passed validation.");
            return result.answers[question.key];
        };
        return { ...condition, value: Array.isArray(condition.value) ? condition.value.map(normalizeValue) : normalizeValue(String(condition.value)) };
    };
    return { ...form, rules: form.rules.map(rule => ({ ...rule, when: normalize(rule.when) })) };
});
function shouldNormalize(question, condition) {
    return numeric.has(question.kind) || (condition.operator !== "contains" && ["country", "us_state", "phone", "email"].includes(question.kind));
}
