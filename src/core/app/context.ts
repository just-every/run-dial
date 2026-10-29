import type { SessionRecord } from "../features/operators";
import type { RuntimeEnvironment } from "../shared/runtime-env";
import type { AppBindings } from "./bindings";
import type { AppServices } from "./services";
import type { Admission, CallbackProvider } from "../platform/public-admission";

export type AppEnvironment = {
  Bindings: AppBindings;
  Variables: {
    runtime: RuntimeEnvironment;
    services: AppServices;
    session: SessionRecord;
    apiCredential: import("../features/api-credentials/auth").Credential;
    inertMutation: boolean;
    admitProvider: (provider: CallbackProvider) => Promise<Admission>;
  };
};
