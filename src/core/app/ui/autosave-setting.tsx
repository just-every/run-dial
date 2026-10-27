import { useEffect, useState } from "react";
import { errorMessage } from "../../api/client";

/** The same saved objects the editor reads; a supplied object avoids another read in a group. */
export function useSettingRead<T>(path: string, initial?: T) {
  const [value, setValue] = useState<T | undefined>(initial);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initial !== undefined) return;
    let active = true;
    void readSetting<T>(path).then(next => { if (active) { setValue(next); setError(""); } }).catch(() => { if (active) setError("These settings could not be loaded."); });
    return () => { active = false; };
  }, [path, initial, attempt]);
  return { value, error, retry: () => setAttempt(current => current + 1) };
}

export async function readSetting<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}

export async function writeSetting(path: string, value: unknown, init: RequestInit) {
  const response = await fetch(path, { ...init, method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export function SettingReadState({ error, retry }: { error: string; retry(): void }) {
  return <p role={error ? "alert" : "status"} className="text-sm text-soft">{error || "Loading settings…"}{error ? <> <button type="button" className="underline" onClick={retry}>Retry</button></> : null}</p>;
}
