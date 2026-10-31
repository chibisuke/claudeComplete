# ClaudeComplete

Copilot-style inline code completions and AI edit suggestions for Visual Studio Code, powered by
the [Claude API](https://platform.claude.com/) or any OpenAI-compatible endpoint (Ollama, LM Studio,
vLLM, OpenRouter, ...).

- **Inline completions**: ghost text while you type, accept with `Tab`.
- **Edit suggestions**: select code, press `Ctrl+Shift+I` (`Cmd+Shift+I` on macOS), describe the change,
  review the inline diff, accept with `Tab` or reject with `Esc`.
- **Prompt caching**: the system prompt and a frozen snapshot of your file are sent as a stable,
  cached prefix so each keystroke only pays for the small window around the cursor.
- **Configurable**: provider, models, system prompts and prompt templates are all settings.

The design document is in [`docs/CONCEPT.md`](docs/CONCEPT.md).

## Installation

Download the latest `.vsix` from the
[GitHub releases](https://github.com/chibisuke/claudecomplete/releases), then in VS Code run
**Extensions: Install from VSIX...** and pick the file.

## Setup

1. Run **ClaudeComplete: Set API Key** from the command palette and paste your Anthropic API key.
   The key is stored in VS Code's secret storage, never in `settings.json`.
2. Press `Ctrl+Alt+Space` in a source file to request a completion. Ghost text appears; press `Tab`
   to accept.
3. Automatic completions while typing are **off by default**. Turn them on by clicking the
   `Claude` item in the status bar, with **ClaudeComplete: Toggle Automatic Completions**, or via
   the `claudeComplete.enabled` setting. `Ctrl+Alt+Space` keeps working in both modes.

### Using an OpenAI-compatible server

```jsonc
{
  "claudeComplete.provider": "openai-compatible",
  "claudeComplete.openai.baseUrl": "http://localhost:11434/v1", // Ollama default
  "claudeComplete.completion.model": "qwen2.5-coder:7b",
  "claudeComplete.edit.model": "qwen2.5-coder:7b",
}
```

If the server needs a key (OpenRouter, vLLM with auth, ...), run **ClaudeComplete: Set API Key**
while the provider is set to `openai-compatible`.

## Edit suggestions

Select code (or just place the cursor on a line), press `Ctrl+Shift+I` and describe the change.
The suggestion is shown without touching your file until you accept it:

- **Native mode** (the Copilot look): VS Code renders the edit itself, as a small floating diff next
  to the line (old text red, new text green) with an arrow marker at the line number that opens an
  Accept/Reject menu. `Tab` accepts, `Esc` dismisses. This uses the `inlineCompletionsAdditions` API
  proposal, which VS Code only grants to extensions you explicitly allow. Enable it once:
  - **Preferences: Configure Runtime Arguments** (`argv.json`) and add
    `"enable-proposed-api": ["chibisuke.claudecomplete"]`, then restart VS Code, or
  - start VS Code with `code --enable-proposed-api chibisuke.claudecomplete`.
    code-server and other OSS builds allow proposals by default. Check the **ClaudeComplete** output
    channel: the activation line reports whether native inline edits are available.
- **Fallback mode** (no setup): changed words are highlighted in place (old red, new green next to
  it), new lines appear green, removed lines red. A green arrow in the gutter marks the first change;
  hovering it shows the full proposed code with clickable Accept / Reject. `Tab` accepts, `Esc`
  rejects, both as a single undo step.

`claudeComplete.edit.presentation` selects the mode (`auto` by default).

## Settings

| Setting                                                  | Default                               | Description                                                                                      |
| -------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `claudeComplete.enabled`                                 | `true`                                | Global switch (also toggled via the status bar item).                                            |
| `claudeComplete.provider`                                | `anthropic`                           | `anthropic` or `openai-compatible`.                                                              |
| `claudeComplete.anthropic.baseUrl`                       | `""`                                  | Optional proxy/gateway URL for the Claude API.                                                   |
| `claudeComplete.openai.baseUrl`                          | `http://localhost:11434/v1`           | Base URL of the OpenAI-compatible API.                                                           |
| `claudeComplete.completion.model`                        | `claude-haiku-5-5`                    | Model for inline completions.                                                                    |
| `claudeComplete.completion.maxTokens`                    | `256`                                 | Output cap per completion.                                                                       |
| `claudeComplete.completion.effort`                       | `low`                                 | Reasoning effort (Claude only).                                                                  |
| `claudeComplete.completion.debounceMs`                   | `300`                                 | Delay after the last keystroke.                                                                  |
| `claudeComplete.completion.multiline`                    | `auto`                                | `auto`, `always` or `never`.                                                                     |
| `claudeComplete.completion.contextLinesBefore` / `After` | `60` / `20`                           | Live window around the cursor.                                                                   |
| `claudeComplete.completion.includeOpenTabs`              | `true`                                | Add other open files of the same language to the snapshot.                                       |
| `claudeComplete.completion.systemPrompt`                 | built-in                              | System prompt for completions.                                                                   |
| `claudeComplete.completion.promptTemplate`               | built-in                              | Template with `{prefix}`, `{suffix}`, `{language}`, `{filename}`.                                |
| `claudeComplete.edit.model`                              | `claude-sonnet-5-5`                   | Model for edit suggestions.                                                                      |
| `claudeComplete.edit.maxTokens`                          | `4096`                                | Output cap per edit.                                                                             |
| `claudeComplete.edit.effort`                             | `medium`                              | Reasoning effort (Claude only).                                                                  |
| `claudeComplete.edit.systemPrompt`                       | built-in                              | System prompt for edits.                                                                         |
| `claudeComplete.edit.promptTemplate`                     | built-in                              | Template with `{selection}`, `{instruction}`, `{language}`, `{filename}`, `{before}`, `{after}`. |
| `claudeComplete.disabledLanguages`                       | `["plaintext","markdown","scminput"]` | No completions for these language IDs.                                                           |
| `claudeComplete.cache.enabled`                           | `true`                                | Use Claude prompt caching.                                                                       |
| `claudeComplete.cache.systemPromptTtl`                   | `5m`                                  | `5m` or `1h` cache TTL for the system prompt block.                                              |
| `claudeComplete.cache.prewarm`                           | `true`                                | Write the cache as soon as a snapshot is created.                                                |
| `claudeComplete.cache.keepAlive`                         | `false`                               | Refresh the cache before it expires while an editor is focused.                                  |
| `claudeComplete.cache.snapshotMaxChars`                  | `32000`                               | Size limit of the context snapshot.                                                              |
| `claudeComplete.cache.snapshotRefreshLines`              | `20`                                  | Line-count drift that triggers a new snapshot.                                                   |
| `claudeComplete.cache.snapshotMaxAgeSec`                 | `120`                                 | Maximum snapshot age.                                                                            |
| `claudeComplete.logPrompts`                              | `false`                               | Log full prompts to the output channel.                                                          |

Empty prompt settings fall back to the built-in defaults in
[`src/prompts/defaults.ts`](src/prompts/defaults.ts). **ClaudeComplete: Reset Prompts to Defaults**
clears your overrides.

## How prompt caching works

Every request is built from three layers, stable first:

1. **System prompt** - never changes during a session. Cached (optionally with a 1 hour TTL).
2. **Context snapshot** - the current file (trimmed around the cursor for large files) plus snippets of
   other open files. Frozen per document and only rebuilt on save, after a configurable line drift,
   when the cursor leaves the covered range, or after `snapshotMaxAgeSec`. Cached with a 5 minute TTL.
3. **Live window** - the lines right around the cursor (or the selection and instruction for edits).
   Small and sent fresh every time.

When a snapshot is created the extension sends a `max_tokens: 0` request that writes the cache
without generating output, so the first real completion is already a cache hit (only while
automatic completions are on; in manual mode the first `Ctrl+Alt+Space` request writes the cache).
The system prompt's TTL is `5m` by default: every request refreshes the timer, so during normal
work the cache simply stays warm. Switch to `1h` with **ClaudeComplete: Toggle Cache Duration**
when you take longer breaks; writes then cost twice as much, reads are unchanged. The status bar
tooltip and the **ClaudeComplete** output channel show uncached, cache-read and cache-write token
counts per request. Caches are per model: completions and edits only share a cache if both use the
same model.

The OpenAI-compatible provider sends the same layered prompt as a system message so that servers
with automatic prefix or KV caching can reuse it; explicit cache markers are not sent.

## Commands

| Command                                         | Description                                |
| ----------------------------------------------- | ------------------------------------------ |
| ClaudeComplete: Set API Key                     | Store the key for the active provider.     |
| ClaudeComplete: Clear API Key                   | Remove the stored key.                     |
| ClaudeComplete: Toggle Inline Completions       | Enable/disable ghost text.                 |
| ClaudeComplete: Edit Selection with Instruction | Start an edit suggestion (`Ctrl+Shift+I`). |
| ClaudeComplete: Accept / Reject Edit Suggestion | `Tab` / `Esc` while a suggestion is shown. |
| ClaudeComplete: Refresh Cached Context Snapshot | Force a new snapshot for the current file. |
| ClaudeComplete: Show Logs                       | Open the output channel.                   |
| ClaudeComplete: Reset Prompts to Defaults       | Clear prompt overrides.                    |

## Development

```bash
npm install
npm run build        # bundle to dist/extension.js
npm run watch        # rebuild on change
npm test             # unit tests (vitest)
npm run test:e2e     # integration tests in a VS Code instance
npm run lint
npm run package      # produce the .vsix
```

Press `F5` in VS Code to launch the Extension Development Host.

### Smoke test in a real editor

`npm run test:smoke` packages the extension, installs it into a temporary
[code-server](https://github.com/coder/code-server) instance and drives the UI with Playwright:
it types code, waits for ghost text, accepts it with `Tab`, runs an edit suggestion and accepts it,
once in fallback mode and once with the API proposal enabled (native inline-edit widget). A local fake API server answers both the Claude and the OpenAI protocol, so no API key
is needed, and the test asserts that the cached prompt prefix (system prompt + snapshot with
`cache_control`) is byte-identical across requests.

Requirements: a code-server release extracted somewhere (`CODE_SERVER_DIR=/path/to/code-server-x.y.z-linux-amd64`)
and Playwright with Chromium (`npx playwright install chromium`). Screenshots and request logs land in
`$SMOKE_OUT` (default: a `claudecomplete-smoke` folder in the system temp directory).

## Releasing

Releases are cut from `master`:

1. Update `CHANGELOG.md` and bump the version: `npm version minor` (creates a commit and tag `vX.Y.Z`).
2. `git push origin master --follow-tags`.
3. The `Release` workflow builds the `.vsix`, attaches it to a GitHub release and, if the `VSCE_PAT`
   or `OVSX_PAT` repository secrets exist, publishes to the VS Code Marketplace / Open VSX.
   The workflow can also be started manually from the Actions tab (`workflow_dispatch`); it then
   releases the version in `package.json`.

## License

MIT
