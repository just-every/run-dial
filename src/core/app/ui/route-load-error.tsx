import { ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router";
import { Button, Card } from "./primitives";

function recoverableLoad(error: unknown) {
  if (error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch|Load failed|NetworkError when attempting to fetch resource/i.test(error.message)) return true;
  return error instanceof Error && error.name === "PageLoadRefusal";
}

/** Reload a failed document/module graph; resetting the boundary retains the browser's rejected import. */
export function RouteLoadError(props: ErrorComponentProps) {
  if (!recoverableLoad(props.error)) return <ErrorComponent {...props} />;
  return <Card className="mx-auto my-8 max-w-xl p-6"><h1 className="text-xl font-bold text-ink">This page could not finish loading</h1><p role="alert" className="mt-3 text-sm leading-6 text-soft">A page resource or connection is temporarily unavailable. Wait a moment, then reload the page. Your saved settings are kept.</p><Button className="mt-5" type="button" onClick={() => window.location.reload()}>Reload page</Button></Card>;
}
