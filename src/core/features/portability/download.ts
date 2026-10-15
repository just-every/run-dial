const exportsPath = "/api/portability/exports";
type ExportProgress = { id: string; phase: string; completed: number };

const failures: Record<string, string> = {
 native_owner_session_required: "Sign in through an owner email link to download a backup.",
 archive_writer_admissions_present: "Work is still recorded as in progress. Refresh export status and try again after it finishes. Contact installation support if it remains blocked.",
 archive_maintenance: "Another export holds maintenance. Wait for it to finish before trying again.",
};

async function request(path: string, body?: object) {
 const response = await fetch(path, {
  method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
 });
 if (!response.ok) {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(failures[result?.error ?? ""] ?? "The backup could not be exported. Refresh export status and try again. Contact installation support if it remains blocked.");
 }
 return response;
}

/** The browser presents its HttpOnly session; no cookie is read or copied. */
export async function downloadArchive(onProgress: (message: string) => void) {
 let id: string | undefined;
 let cleanupConfirmed = true;
 let archive: Blob;
 try {
  onProgress("Starting backup. Keep this page open until the download is ready.");
  const created = await (await request(exportsPath, {})).json() as { id: string };
  if (!/^[a-zA-Z0-9-]+$/.test(created.id)) throw new Error("The export returned an invalid job reference.");
  id = created.id;
  let progress: ExportProgress = { id, phase: "building", completed: 0 };
  while (progress.phase === "building") {
   onProgress(`Preparing backup · ${progress.completed} archive parts ready. Keep this page open.`);
   progress = await (await request(`${exportsPath}/${id}/advance`, { expectedPart: progress.completed, maxParts: 10 })).json() as ExportProgress;
  }
  if (progress.phase !== "complete") throw new Error("The export did not complete. Start a new backup.");
  onProgress("Downloading backup. Keep this page open.");
  archive = await (await request(`${exportsPath}/${id}/download`)).blob();
 } finally {
  if (id) {
   try { await request(`${exportsPath}/${id}/abort`, {}); }
   catch { cleanupConfirmed = false; }
  }
 }
 return { archive, cleanupConfirmed };
}

export function saveArchive(archive: Blob) {
 const url = URL.createObjectURL(archive);
 const link = document.createElement("a");
 link.href = url;
 link.download = `dial-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.rer`;
 document.body.appendChild(link);
 link.click();
 link.remove();
 // Give the browser time to consume the object URL before releasing its bytes.
 window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
