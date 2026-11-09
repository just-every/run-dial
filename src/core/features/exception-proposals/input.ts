import { z } from "zod";

/** Only the identity of an already submitted native request crosses this door. */
export const exceptionRequestSchema = z.object({ id: z.string().length(26) }).strict();

export const exceptionQuerySchema = z.object({}).strict();
