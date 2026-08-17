import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";
import globals from "globals";

// One screen directory per user-facing flow. Each flow may freely import
// lib/, format/, components/ (unrestricted below) but never reach into a
// sibling flow's screens/ directory — that boundary is generated, not
// hand-written, because at N flows it's N*(N-1) restriction entries in
// three forms each (see the comment on `crossFlowRestrictionsFor`), and
// hand-writing it once already produced a silent regression (Phase 9: the
// guard for one flow pair went inert because only the qualified
// "**/screens/x/**" form was listed, not the relative "../x/**" one a real
// import string actually uses).
const FLOWS = ["vigie-chiro", "vigie-process", "archive", "offsite"];

/**
 * The `no-restricted-imports` patterns that forbid `flow` from importing any
 * *other* flow's screens/ directory, in the three forms a real import string
 * can take: `no-restricted-imports` matches the literal import string, not
 * the resolved path, and `../vigie-process/x.js` never contains "screens/".
 *
 * Deliberately scoped to `screens/<other>/` and never a bare `**\/<other>/**`
 * — several flows legitimately import a same-named module under `lib/`
 * (e.g. `screens/archive/` importing `lib/vigie-chiro/extractCommonPrefix`,
 * or any future flow importing `lib/offsite/`), and a bare pattern would
 * block that too.
 */
const crossFlowRestrictionsFor = (flow) =>
  FLOWS.filter((other) => other !== flow).flatMap((other) => [
    `**/screens/${other}/**`,
    `../${other}/**`,
    `../../${other}/**`,
  ]);

const flowBoundaryBlocks = FLOWS.map((flow) => ({
  files: [`src/screens/${flow}/**/*.{ts,tsx}`],
  ignores: [
    `src/screens/${flow}/**/*.test.{ts,tsx}`,
    `src/screens/${flow}/**/__tests__/**`,
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: crossFlowRestrictionsFor(flow),
            message: "No cross-flow imports between screen directories.",
          },
        ],
      },
    ],
  },
}));

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
  ...flowBoundaryBlocks,
);
