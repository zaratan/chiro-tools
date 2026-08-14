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
    files: ["src/format/**/*.{ts,tsx}"],
    ignores: ["src/format/**/*.test.{ts,tsx}", "src/format/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["ink", "ink-*", "react", "react-*"],
              message: "src/format/ must stay UI-free (no ink/react imports).",
            },
            {
              group: [
                "**/lib/**",
                "**/screens/**",
                "**/components/**",
                "**/app.js",
                "**/index.js",
              ],
              message:
                "src/format/ is presentational-pure: no lib/, screens/, components/, or app imports.",
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
              // Both the "screens/"-qualified form AND the bare relative
              // forms. no-restricted-imports matches the literal import
              // string, and a real cross-flow import reads
              // "../vigie-process/x.js" — which never contains "screens/".
              // Listing only the qualified form silently disables the guard.
              // A bare "**/vigie-process/**" is not an option either: it
              // would also match the legitimate src/lib/vigie-chiro/ module.
              group: [
                "**/screens/vigie-process/**",
                "../vigie-process/**",
                "../../vigie-process/**",
                "**/screens/archive/**",
                "../archive/**",
                "../../archive/**",
              ],
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
              // Cannot use a bare "**/vigie-chiro/**": it would also match
              // the legitimate src/lib/vigie-chiro/ business module.
              group: [
                "**/screens/vigie-chiro/**",
                "../vigie-chiro/**",
                "../../vigie-chiro/**",
                "**/screens/archive/**",
                "../archive/**",
                "../../archive/**",
              ],
              message: "No cross-flow imports between screen directories.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/screens/archive/**/*.{ts,tsx}"],
    ignores: [
      "src/screens/archive/**/*.test.{ts,tsx}",
      "src/screens/archive/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Qualified + relative forms, cf. the vigie-chiro block above.
              // A bare "**/vigie-chiro/**" would also match the legitimate
              // src/lib/vigie-chiro/ module this flow imports
              // (extractCommonPrefix), so both forms must be listed.
              group: [
                "**/screens/vigie-chiro/**",
                "../vigie-chiro/**",
                "../../vigie-chiro/**",
                "**/screens/vigie-process/**",
                "../vigie-process/**",
                "../../vigie-process/**",
              ],
              message: "No cross-flow imports between screen directories.",
            },
          ],
        },
      ],
    },
  },
);
