import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../core/features/operators/ui/sign-in-page";
import { loadSigninOptions } from "../core/app/loaders";

export const Route = createFileRoute('/signin')({ loader: () => loadSigninOptions(), component: withEditorLeaf(SignIn) });
function SignIn() { return <SignInPage options={Route.useLoaderData()} />; }
