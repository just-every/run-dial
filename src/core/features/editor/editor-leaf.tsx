import { useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { useEditorLeafReady } from "../../../../modules/editor/react";

/** Commit readiness with the actual route content, including lazy remounts. */
export function withEditorLeaf(Page: ComponentType) {
  return function EditorLeaf() {
    const routeKey = useRouterState({ select: (state) => state.location.href });
    useEditorLeafReady(routeKey);
    return <Page />;
  };
}
