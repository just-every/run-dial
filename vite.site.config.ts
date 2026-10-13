import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { docsSite } from "./src/core/features/public-site/docs/build/plugin";
import { readRepository } from "./src/core/features/public-site/docs/build/site";
export default defineConfig({
  define: { __DIAL_SOURCE_URL__: JSON.stringify(readRepository(process.cwd()).url) },
  plugins: [docsSite(), react(), tailwindcss()],
});
