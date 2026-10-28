import type { ZodType } from "zod";
import type { RoutingFormInput } from "./types";
export declare const questionKinds: readonly ["text", "email", "phone", "number", "single_choice", "multiple_choice", "dropdown", "company_size", "country", "us_state", "hidden"];
export declare const routingFormInput: ZodType<RoutingFormInput>;
export { validateRoutingAnswers } from "./answer-validation.mjs";
