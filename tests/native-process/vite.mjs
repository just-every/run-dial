import { fileURLToPath } from "node:url";

// Keep fixture-source access an explicit choice by the native test/review
// harness. Production-shaped runtime-server and RER commands use normal Vite.
export const fixtureVite = ["exec", "vite", "--config", fileURLToPath(new URL("../vite.config.ts", import.meta.url))];
