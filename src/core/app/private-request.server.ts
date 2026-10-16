import { AsyncLocalStorage } from "node:async_hooks";
import type { AppBindings } from "./bindings";
import type { AppServices } from "./services";
import type { OperatorAuth } from "../../../modules/operator-auth/index.mjs";

type PrivateRequest = { request: Request; bindings: AppBindings; services: AppServices; session?: ReturnType<OperatorAuth["getSession"]> };
const current = new AsyncLocalStorage<PrivateRequest>();

/** A fresh scope for one private HTTP invocation, including Start's SSR/function dispatch. */
export function withPrivateRequest<T>(request: Request, bindings: AppBindings, services: AppServices, run: () => T) {
  // These immutable inputs are shared only inside this HTTP read, never across navigations.
  const profile = services.hostProfile.getProfile.bind(services.hostProfile);
  let profileRead: ReturnType<typeof profile> | undefined;
  services.hostProfile.getProfile = () => profileRead ??= profile();
  const events = services.eventTypes.listEventTypes.bind(services.eventTypes);
  let eventRead: ReturnType<typeof events> | undefined;
  services.eventTypes.listEventTypes = () => eventRead ??= events();
  return current.run({ request, bindings, services }, run);
}

export function privateRequestServices(bindings: AppBindings) {
  const scope = current.getStore();
  return scope?.bindings.DB === bindings.DB ? scope.services : undefined;
}

export function nativeRequestSession(request: Request, auth: OperatorAuth) {
  const scope = current.getStore();
  if (!scope || scope.request !== request) return auth.getSession(request);
  return scope.session ??= auth.getSession(request);
}
