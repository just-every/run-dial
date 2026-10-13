import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useDocumentData } from "../../../app/document-data";
import type { PublicProfile } from "../../public-booking";

/**
 * The host's public profile, when one is configured. The server reads `/api/public/home/profile` into the document data for `/`
 * (no profile is simply no data), so a landing loaded at `/` already has its answer. Reached by client-side navigation from
 * another page, the landing reloads the document data for `/` the same way, and the link follows what the server says.
 */
export function useHomeProfile() {
  const router = useRouter();
  useEffect(() => {
    const [entry] = performance.getEntriesByType("navigation");
    if (entry && new URL(entry.name).pathname === "/") return;
    void router.invalidate();
  }, [router]);
  return useDocumentData<{ profile?: PublicProfile }>()?.profile;
}
