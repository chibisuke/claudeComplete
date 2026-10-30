import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // The real `vscode` module only exists inside the editor; unit tests use a tiny stub.
      vscode: path.resolve(here, "test/unit/vscode-stub.ts"),
    },
  },
});
