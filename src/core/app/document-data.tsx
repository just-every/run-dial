import { createContext, useContext } from "react";
export const DocumentData = createContext<{ status: number; payload: unknown; renderInstant?: string }>({ status: 200, payload: null });
export function useDocumentData<T>() { return useContext(DocumentData).payload as T | undefined; }

export function useDocumentInstant() {
  const instant = useContext(DocumentData).renderInstant;
  if (!instant) throw new Error("Document render instant is missing");
  return instant;
}
