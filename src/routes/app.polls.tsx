import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { PollsPage } from "../core/features/polls/client";


export const Route = createFileRoute('/app/polls' )({ codeSplitGroupings: [], component: withEditorLeaf(PollsPage) });
