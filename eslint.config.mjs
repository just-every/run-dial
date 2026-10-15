import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "**/.wrangler/**", "node_modules/**", "wrangler.toml"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooks },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "jsx-a11y/label-has-associated-control": ["error", { controlComponents: ["Input", "Select", "Textarea"], depth: 3 }],
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
    },
  },
  // Adopted erasure runtime executes inside the Worker; keep all lint rules active.
  { files: ["src/modules/erasure/*.mjs"], languageOptions: { globals: globals.worker } },
  // Exact Base producer runtime rejects control characters in trust-boundary inputs.
  { files: ["scripts/delivery/base/**/*.mjs"], rules: { "no-control-regex": "off" } },
  // Exact upstream authoring 1.1 bytes: its own tests validate these pinned files.
  { files: ["scripts/edition-authoring/cli.mjs"], rules: { "@typescript-eslint/no-unused-vars": "off" } },
  { files: ["scripts/edition-authoring/files.mjs"], rules: { "no-control-regex": "off" } },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
