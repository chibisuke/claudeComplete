import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../../");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ["--disable-extensions", "--disable-gpu"],
  });
}

main().catch((err) => {
  console.error("Failed to run e2e tests", err);
  process.exit(1);
});
