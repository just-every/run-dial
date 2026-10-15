import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../core/features/operators/ui/sign-in-page";
import { loadSigninOptions } from "../core/app/loaders";

export const Route = createFileRoute('/signin')({
  validateSearch: (search: Record<string, unknown>): { login_hint?: string } => ({ login_hint: typeof search.login_hint === "string" ? search.login_hint : undefined }),
  loaderDeps: ({ search }) => ({ loginHint: search.login_hint }),
  loader: ({ deps }) => loadSigninOptions({ data: deps }),
  component: withEditorLeaf(SignIn),
});
function SignIn() { return <SignInPage options={Route.useLoaderData()} />; }
