import * as path from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20_000 });
  const files = await glob("**/*.test.js", { cwd: __dirname });
  for (const f of files) {
    mocha.addFile(path.resolve(__dirname, f));
  }
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) =>
      failures > 0 ? reject(new Error(`${failures} tests failed.`)) : resolve(),
    );
  });
}
