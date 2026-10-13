import { checkMailProvider } from "../../src/core/platform/mail/connection.ts";

export default {
  async fetch() {
    try {
      const result = await checkMailProvider({ provider: "sendgrid", apiKey: "synthetic-readiness-key", from: "noreply@business.example" }, fetch);
      return Response.json(result);
    } catch (error) {
      return Response.json({ code: error.code, retryable: error.retryable }, { status: 503 });
    }
  },
};
