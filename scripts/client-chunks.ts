type ChunkGraph = { getModuleInfo(id: string): { isEntry: boolean; importers: string[] } | null };

/** Keep the existing initial graph together; dynamic page imports stay split. */
export function initialClientChunk() {
  const initial = new Map<string, boolean>();
  return (id: string, graph: ChunkGraph) => {
    // Leave style/asset ownership with Vite's existing plugins.
    if (/\.(css|scss|sass|less|styl)(\?|$)/.test(id) && !id.includes("?url")) return null;
    if (!initial.has(id)) {
      const seen = new Set<string>();
      const reachesInitial = (moduleId: string): boolean => {
        if (seen.has(moduleId)) return false;
        seen.add(moduleId);
        const module = graph.getModuleInfo(moduleId);
        if (!module) return false;
        return module.isEntry || moduleId.split("?")[0].replaceAll("\\", "/").endsWith("/src/router.tsx") || module.importers.some(reachesInitial);
      };
      initial.set(id, reachesInitial(id));
    }
    return initial.get(id) ? "app-runtime" : null;
  };
}
