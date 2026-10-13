import { useEffect, useState } from "react";

/** Keep server-rendered controlled inputs read-only until their handlers are attached. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return hydrated;
}
