// Drives code-server with Playwright: inline completion + edit suggestion flow.
import fs from "node:fs";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 200, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) {
      return v;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await sleep(interval);
  }
}

async function runCommand(page, title) {
  await page.keyboard.press("F1");
  const input = page.locator(".quick-input-widget input.input");
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(`>${title}`);
  await page
    .locator(".quick-input-list .monaco-list-row", { hasText: title })
    .first()
    .waitFor({ timeout: 10000 });
  await input.press("Enter");
}

export async function runScenario({
  chromium,
  url,
  workspace,
  provider,
  native = false,
  label = provider,
  shots,
  log,
}) {
  const demo = path.join(workspace, "demo.ts");
  fs.writeFileSync(demo, "// smoke test\n");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`[pageerror] ${e.message}`));
  const shot = async (name) => {
    await page.screenshot({ path: path.join(shots, `${label}-${name}.png`) });
  };
  try {
    await page.goto(`${url}/?folder=${encodeURIComponent(workspace)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".monaco-workbench").waitFor({ timeout: 60000 });
    await page.locator(".statusbar").waitFor({ timeout: 60000 });
    await sleep(3000);
    // Dismiss any notifications/dialogs (welcome, trust, sign-in, ...) and close the secondary side bar.
    await page.keyboard.press("Escape");
    await runCommand(page, "View: Close Secondary Side Bar").catch(() => undefined);
    await page.keyboard.press("Escape");

    if (provider === "anthropic") {
      await runCommand(page, "ClaudeComplete: Set API Key");
      await page
        .locator(".quick-input-titlebar", { hasText: "API key" })
        .waitFor({ timeout: 10000 });
      const input = page.locator(".quick-input-widget input.input");
      await input.waitFor({ state: "visible", timeout: 10000 });
      await input.fill("sk-ant-fake-key");
      await input.press("Enter");
      await sleep(1000);
    }

    // Open demo.ts
    await page.keyboard.press("Control+P");
    const qo = page.locator(".quick-input-widget input.input");
    await qo.waitFor({ state: "visible", timeout: 10000 });
    await qo.fill("demo.ts");
    await page
      .locator(".quick-input-list .monaco-list-row", { hasText: "demo.ts" })
      .first()
      .waitFor({ timeout: 10000 });
    await qo.press("Enter");
    const editor = page.locator(".monaco-editor .view-lines").first();
    await editor.waitFor({ timeout: 20000 });
    await sleep(1500);
    await editor.click();
    await page.keyboard.press("Control+End");

    // --- Inline completion ---
    await page.keyboard.type("function add(a: number, b: number): number {", { delay: 20 });
    await waitFor(
      () =>
        page.locator(".ghost-text-decoration, .ghost-text-decoration-preview, .ghost-text").count(),
      {
        timeout: 20000,
        label: "ghost text",
      },
    );
    await sleep(300);
    await shot("01-ghost-text");
    await page.keyboard.press("Tab");
    await sleep(300);
    await page.keyboard.press("Control+S");
    await waitFor(() => fs.readFileSync(demo, "utf8").includes("return a + b;"), {
      label: "accepted completion on disk",
    });
    log(`[${label}] inline completion accepted: ok`);

    // --- Edit suggestion ---
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type('const greeting = "hi";', { delay: 20 });
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await runCommand(page, "ClaudeComplete: Edit Selection with Instruction");
    await page
      .locator(".quick-input-titlebar", { hasText: "Edit instruction" })
      .waitFor({ timeout: 10000 });
    const instr = page.locator(".quick-input-widget input.input");
    await instr.waitFor({ state: "visible", timeout: 10000 });
    await instr.fill("say hello world instead");
    await instr.press("Enter");
    if (native) {
      // VS Code's own inline-edit widget (the Copilot look).
      // The proposed text is rendered by the editor widget, not part of the document yet.
      await waitFor(
        () =>
          page.evaluate(() => {
            // The inline-edit widget may render its text inside SVG, which innerText skips.
            const haystack =
              (document.body.textContent || "") +
              " " +
              Array.from(document.querySelectorAll("svg text"))
                .map((t) => t.textContent)
                .join(" ");
            return haystack.includes("hello world") || haystack.includes("hello");
          }),
        { timeout: 20000, label: "native inline edit widget" },
      );
      if (fs.readFileSync(demo, "utf8").includes("hello world")) {
        throw new Error("document should not contain the new text before accepting");
      }
      await sleep(800);
      await shot("02-edit-native");
      const gutter = await page
        .locator("[class*='inline-edits-view-gutter-indicator'], [class*='gutter-indicator']")
        .count();
      log(`[${label}] native inline edit widget visible, gutter indicator elements: ${gutter}`);
      await page.keyboard.press("Tab");
    } else {
      await page
        .locator(".codelens-decoration", { hasText: "Accept" })
        .first()
        .waitFor({ timeout: 20000 });
      await sleep(500);
      // Decorated preview: the old line stays, the new words are shown as decorations.
      const lines = await page.locator(".view-line").allInnerTexts();
      const greetingLines = lines.filter((l) => l.includes("greeting"));
      if (greetingLines.length !== 1) {
        throw new Error(
          `expected exactly one greeting line in the preview, got ${JSON.stringify(greetingLines)}`,
        );
      }
      if (fs.readFileSync(demo, "utf8").includes("hello world")) {
        throw new Error("document should not contain the new text before accepting");
      }
      await shot("02-edit-preview");
      await page.locator(".view-line", { hasText: "greeting" }).first().hover();
      await sleep(400);
      await editor.click();
      await page.keyboard.press("Tab");
    }
    await sleep(300);
    await page.keyboard.press("Control+S");
    await waitFor(
      () => {
        const t = fs.readFileSync(demo, "utf8");
        return t.includes('"hello world"') && !t.includes('"hi"');
      },
      { label: "accepted edit on disk" },
    );
    await shot("03-after-accept");
    log(`[${label}] edit suggestion accepted: ok`);
    log(`[${label}] final demo.ts:\n${fs.readFileSync(demo, "utf8")}`);
  } catch (err) {
    await shot("fail").catch(() => undefined);
    throw err;
  } finally {
    await browser.close();
  }
}
