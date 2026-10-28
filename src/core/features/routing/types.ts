import { questionKinds } from "./validation.mjs";
export { questionKinds } from "./validation.mjs";

export type Question = {
  key: string;
  label: string;
  kind: typeof questionKinds[number];
  required: boolean;
  options?: string[];
  parameter?: string;
  private?: boolean;
};

export type RoutingAnswers = Record<string, string | string[]>;

export type Condition = {
  question: string;
  operator: "equals" | "contains" | "in" | "greater_than" | "range";
  value: string | number | string[];
  max?: number;
} | {
  mode: "and" | "or";
  conditions: Condition[];
};

export type Outcome = {
  kind: "event";
  eventTypeId: string;
  redirect?: { url: string; fields: string[] };
} | {
  kind: "message";
  message: string;
} | {
  kind: "url";
  url: string;
};

export type RoutingRule = { id: string; label: string; when: Condition; outcome: Outcome };

export type RoutingFormInput = {
  title: string;
  slug: string;
  published: boolean;
  questions: Question[];
  rules: RoutingRule[];
  fallback: Outcome;
};

export type RouteMatch = { ruleId: string | null; ruleLabel: string; outcome: Outcome };
