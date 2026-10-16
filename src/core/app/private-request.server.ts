import { AsyncLocalStorage } from "node:async_hooks";
import type { AppBindings } from "./bindings";
import type { AppServices } from "./services";
import type { OperatorAuth } from "../../../modules/operator-auth/index.mjs";

type PrivateRequest = { request: Request; bindings: AppBindings; services: AppServices; reads: Promise<unknown>[]; session?: ReturnType<OperatorAuth["getSession"]> };
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
  const event = services.eventTypes.getEventType.bind(services.eventTypes);
  const eventReads = new Map<string, ReturnType<typeof event>>();
  services.eventTypes.getEventType = id => {
    let read = eventReads.get(id);
    if (!read) { read = event(id); eventReads.set(id, read); }
    return read;
  };
  const completion = services.hostSetup.completion.bind(services.hostSetup);
  let completionRead: ReturnType<typeof completion> | undefined;
  services.hostSetup.completion = () => completionRead ??= completion();
  return current.run({ request, bindings, services, reads: [] }, run);
}

export function privateRequestServices(bindings: AppBindings) {
  const scope = current.getStore();
  return scope?.bindings.DB === bindings.DB ? scope.services : undefined;
}

export function deferPrivateRead<T>(task: Promise<T>) {
  const scope = current.getStore();
  if (!scope) throw new Error("Private streamed reads require their HTTP request scope.");
  // Observe a speculative failure immediately; its actual consumer still gets
  // the original rejection. Redirects can finish before that consumer runs.
  scope.reads.push(task.then(() => undefined, () => undefined));
  return task;
}

export const privateReadTasks = () => current.getStore()?.reads ?? [];

export function nativeRequestSession(request: Request, auth: OperatorAuth) {
  const scope = current.getStore();
  if (!scope || scope.request !== request && (
    scope.request.url !== request.url || scope.request.method !== request.method ||
    JSON.stringify([...scope.request.headers]) !== JSON.stringify([...request.headers])
  )) return auth.getSession(request);
  return scope.session ??= auth.getSession(request);
}
