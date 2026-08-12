import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "*.config.ts",
      "*.config.js",
      "scripts/**",
      "src/lib/audio/splitWorker.bundled.mjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  // Architecture boundaries — machine-enforced version of the layer table in
  // CLAUDE.md ("Architecture — règles dures"). Test files are exempt: they may
  // legitimately cross layers (e.g. screen tests rendering with lib fixtures).
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    ignores: ["src/lib/**/*.test.{ts,tsx}", "src/lib/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["ink", "ink-*", "react", "react-*"],
              message: "src/lib/ must stay UI-free (no ink/react imports).",
            },
            {
              // app.js/index.js import ink and every screen — one hop through
              // them would reintroduce the whole UI layer into lib/.
              group: [
                "**/screens/**",
                "**/components/**",
                "**/app.js",
                "**/index.js",
              ],
              message: "src/lib/ must not import UI layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    ignores: [
      "src/components/**/*.test.{ts,tsx}",
      "src/components/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/**", "**/screens/**", "**/app.js", "**/index.js"],
              message:
                "src/components/ is presentational: no lib/, screens/, or app imports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/screens/vigie-chiro/**/*.{ts,tsx}"],
    ignores: [
      "src/screens/vigie-chiro/**/*.test.{ts,tsx}",
      "src/screens/vigie-chiro/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/vigie-process/**"],
              message: "No cross-flow imports between screen directories.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/screens/vigie-process/**/*.{ts,tsx}"],
    ignores: [
      "src/screens/vigie-process/**/*.test.{ts,tsx}",
      "src/screens/vigie-process/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/vigie-chiro/**"],
              message: "No cross-flow imports between screen directories.",
            },
          ],
        },
      ],
    },
  },
);
