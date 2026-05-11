import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    coverage: {
      include: ["src/lib/**"],
      reporter: ["text", "html"],
    },
  },
});
