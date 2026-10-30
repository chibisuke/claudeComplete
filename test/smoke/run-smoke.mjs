// Smoke test orchestrator: builds the .vsix, installs it into a throw-away code-server,
// starts a fake LLM API and drives the editor with Playwright for both providers.
//
// Usage: node test/smoke/run-smoke.mjs [--provider anthropic|openai-compatible] [--keep]
// Env:   CODE_SERVER_DIR (extracted code-server directory), SMOKE_OUT (screenshot/log directory)
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runScenario } from "./scenario.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const args = process.argv.slice(2);
const providerArg = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : undefined;
const providers = providerArg ? [providerArg] : ["anthropic", "openai-compatible"];
// Each run: provider + whether VS Code's proposed inline-edit API is enabled for the extension.
const runs = providers.map((provider) => ({ provider, native: false }));
if (!providerArg || args.includes("--native")) {
  runs.push({ provider: "anthropic", native: true });
}
if (args.includes("--native-only")) {
  runs.splice(0, runs.length, { provider: providerArg || "anthropic", native: true });
}
const keep = args.includes("--keep");
const out = process.env.SMOKE_OUT || path.join(os.tmpdir(), "claudecomplete-smoke");
fs.mkdirSync(out, { recursive: true });
const logLines = [];
const log = (m) => {
  console.log(m);
  logLines.push(m);
};

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

function findCodeServer() {
  const dir = process.env.CODE_SERVER_DIR;
  const candidates = [
    dir && path.join(dir, "bin/code-server"),
    dir && path.join(dir, "code-server"),
    "code-server",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execSync(`"${c}" --version`, { stdio: "ignore" });
      return c;
    } catch {
      // try next
    }
  }
  throw new Error(
    "code-server not found. Set CODE_SERVER_DIR to an extracted code-server release or install it on PATH.",
  );
}

function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.status < 500) {
          return resolve();
        }
      } catch {
        // not up yet
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timeout waiting for ${url}`));
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

function assertRequests(provider, logFile) {
  const lines = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const reqs = lines.map((l) => JSON.parse(l));
  const fail = (m) => {
    throw new Error(`[${provider}] request assertion failed: ${m}`);
  };
  if (reqs.length === 0) {
    fail("no requests reached the fake server");
  }
  if (provider === "anthropic") {
    const prewarm = reqs.filter((r) => r.kind === "anthropic" && r.body.max_tokens === 0);
    const real = reqs.filter((r) => r.kind === "anthropic" && r.body.max_tokens > 0);
    if (prewarm.length === 0) {
      fail("no cache pre-warm request (max_tokens: 0)");
    }
    if (real.length === 0) {
      fail("no completion/edit request");
    }
    for (const r of real) {
      const sys = r.body.system;
      if (!Array.isArray(sys) || sys.length !== 2) {
        fail(`system should be 2 blocks, got ${JSON.stringify(sys).slice(0, 200)}`);
      }
      if (!sys[0].cache_control || !sys[1].cache_control) {
        fail("both system blocks must carry cache_control");
      }
      if (!sys[1].text.startsWith("Context snapshot")) {
        fail("second system block must be the snapshot");
      }
      if (r.body.temperature !== undefined) {
        fail("temperature must not be sent");
      }
      if (!Array.isArray(r.body.stop_sequences) || r.body.stop_sequences.length === 0) {
        fail("stop_sequences missing");
      }
      if (r.headers.auth !== "present") {
        fail("API key header missing");
      }
    }
    const completions = real.filter((r) => String(r.body.messages[0].content).includes("<prefix>"));
    const prefixes = new Set(completions.map((r) => JSON.stringify(r.body.system)));
    log(
      `[anthropic] ${prewarm.length} pre-warm, ${real.length} real requests, ${completions.length} completions with ${prefixes.size} distinct cached prefix(es)`,
    );
    // Saving the file legitimately refreshes the snapshot, so require reuse rather than a single prefix.
    if (completions.length > 1 && prefixes.size >= completions.length) {
      fail("no two completion requests shared a cached prefix");
    }
  } else {
    const real = reqs.filter((r) => r.kind === "openai");
    if (real.length === 0) {
      fail("no OpenAI-compatible requests");
    }
    for (const r of real) {
      if (r.body.stream !== true || !r.body.stream_options?.include_usage) {
        fail("stream/stream_options not set");
      }
      if (r.body.messages[0].role !== "system") {
        fail("first message must be the system message");
      }
    }
    log(`[openai-compatible] ${real.length} requests, prompt layout ok`);
  }
}

async function runProvider(provider, codeServer, vsix, chromium, native) {
  const label = native ? `${provider}-native` : provider;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cc-smoke-${label}-`));
  const userData = path.join(tmp, "user-data");
  const extDir = path.join(tmp, "extensions");
  const ws = path.join(tmp, "ws");
  fs.mkdirSync(path.join(userData, "User"), { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const fakePort = await freePort();
  const csPort = await freePort();
  const fakeLog = path.join(tmp, "requests.log");

  const settings = {
    "workbench.startupEditor": "none",
    "chat.disableAIFeatures": true,
    "chat.commandCenter.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.activityBar.location": "default",
    "workbench.enableExperiments": false,
    "workbench.tips.enabled": false,
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "editor.inlineSuggest.enabled": true,
    "editor.quickSuggestions": false,
    "editor.suggestOnTriggerCharacters": false,
    "editor.autoClosingBrackets": "never",
    "editor.autoClosingQuotes": "never",
    "editor.autoIndent": "none",
    "editor.formatOnType": false,
    "editor.acceptSuggestionOnEnter": "off",
    "files.autoSave": "off",
    "claudeComplete.provider": provider,
    "claudeComplete.anthropic.baseUrl": `http://127.0.0.1:${fakePort}`,
    "claudeComplete.openai.baseUrl": `http://127.0.0.1:${fakePort}/v1`,
    "claudeComplete.completion.debounceMs": 50,
    "claudeComplete.cache.prewarm": true,
    "claudeComplete.logPrompts": true,
    // code-server grants proposed APIs to every extension, so force the fallback explicitly.
    "claudeComplete.edit.presentation": native ? "native" : "inline-decorations",
  };
  fs.writeFileSync(path.join(userData, "User", "settings.json"), JSON.stringify(settings, null, 2));

  log(`[${label}] installing extension into ${extDir}`);
  execSync(
    `"${codeServer}" --install-extension "${vsix}" --extensions-dir "${extDir}" --user-data-dir "${userData}"`,
    {
      stdio: "pipe",
    },
  );

  const fake = spawn(process.execPath, [path.join(here, "fake-server.mjs")], {
    env: { ...process.env, FAKE_PORT: String(fakePort), FAKE_LOG: fakeLog },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const cs = spawn(
    codeServer,
    [
      "--auth",
      "none",
      "--bind-addr",
      `127.0.0.1:${csPort}`,
      "--disable-telemetry",
      "--disable-update-check",
      "--disable-workspace-trust",
      ...(native ? ["--enable-proposed-api", "chibisuke.claudecomplete"] : []),
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extDir,
      ws,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
    },
  );
  const csOut = [];
  cs.stdout.on("data", (d) => csOut.push(String(d)));
  cs.stderr.on("data", (d) => csOut.push(String(d)));

  try {
    await waitForHttp(`http://127.0.0.1:${fakePort}/`, 10000);
    await waitForHttp(`http://127.0.0.1:${csPort}/healthz`, 60000);
    log(`[${label}] code-server up on :${csPort}, fake api on :${fakePort}`);
    await runScenario({
      chromium,
      url: `http://127.0.0.1:${csPort}`,
      workspace: ws,
      provider,
      native,
      label,
      shots: out,
      log,
    });
    assertRequests(provider, fakeLog);
  } finally {
    // Collect the extension's output channel log for diagnostics.
    try {
      const logsRoot = path.join(userData, "logs");
      const files = fs.existsSync(logsRoot)
        ? execSync(`find "${logsRoot}" -name "*ClaudeComplete*.log"`)
            .toString()
            .trim()
            .split("\n")
            .filter(Boolean)
        : [];
      for (const f of files) {
        const content = fs.readFileSync(f, "utf8");
        fs.writeFileSync(path.join(out, `${label}-output-channel.log`), content);
        log(`[${label}] output channel (${f}):\n${content.split("\n").slice(-25).join("\n")}`);
      }
    } catch (e) {
      log(`[${provider}] could not collect logs: ${e.message}`);
    }
    if (fs.existsSync(fakeLog)) {
      fs.copyFileSync(fakeLog, path.join(out, `${label}-requests.log`));
    }
    cs.kill("SIGTERM");
    fake.kill("SIGTERM");
    if (!keep) {
      fs.rmSync(tmp, { recursive: true, force: true });
    } else {
      log(`[${label}] kept ${tmp}`);
    }
    if (process.exitCode) {
      log(csOut.join("").split("\n").slice(-30).join("\n"));
    }
  }
}

async function main() {
  const { chromium } = require("playwright");
  const codeServer = findCodeServer();
  log(`using ${codeServer}`);
  log("packaging extension...");
  execSync("npm run package --silent", { cwd: root, stdio: "pipe" });
  const vsix = fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".vsix"))
    .map((f) => path.join(root, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!vsix) {
    throw new Error("no .vsix produced");
  }
  let failed = false;
  for (const { provider, native } of runs) {
    const label = native ? `${provider}-native` : provider;
    try {
      await runProvider(provider, codeServer, vsix, chromium, native);
      log(`[${label}] PASS`);
    } catch (err) {
      failed = true;
      process.exitCode = 1;
      log(`[${label}] FAIL: ${err.stack || err.message}`);
    }
  }
  fs.writeFileSync(path.join(out, "smoke.log"), logLines.join("\n"));
  log(`artifacts in ${out}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
