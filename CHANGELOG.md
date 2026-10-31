# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-31

### Changed

- Automatic inline completions are now **off by default** (`claudeComplete.enabled: false`). Toggle them via the status bar item or **ClaudeComplete: Toggle Automatic Completions**.

### Added

- **ClaudeComplete: Trigger Inline Completion** (`Ctrl+Alt+Space`) requests a single completion at any time, also while automatic completions are off. Typing and the editor's own trigger shortcut cost nothing in that mode.
- **ClaudeComplete: Toggle Cache Duration (5m / 1h)** switches the system-prompt cache TTL; the status bar tooltip shows the current duration and links to the toggle.

## [0.2.0] - 2026-10-30

### Changed

- Edit suggestions now use VS Code's native inline-edit UI (the Copilot look: floating diff next to the line, gutter marker with Accept/Reject menu, Tab/Esc) when the `inlineCompletionsAdditions` API proposal is enabled for the extension. See README for how to enable it.
- Without the proposal, the fallback shows changes in place: replaced words highlighted red with the new words next to them, new lines green, removed lines red, a gutter marker whose hover offers clickable Accept/Reject and shows the full proposed code. Accept/reject replace the region in one undo step.
- New setting `claudeComplete.edit.presentation` (`auto` | `native` | `inline-decorations`).

### Added

- Smoke test runs a third scenario with the proposal enabled and verifies the native widget.

## [0.1.1] - 2026-10-30

### Fixed

- Inline completions that start with a line break (e.g. a function body after `{`) kept the break instead of being glued onto the current line.
- Full-file context snapshots were rebuilt on every request once the cursor moved below the last line captured, defeating prompt caching. A full-file snapshot now stays valid until save, drift or age limits trigger a refresh.

### Added

- `npm run test:smoke`: end-to-end smoke test that installs the packaged extension into a throw-away code-server, drives it with Playwright against a local fake Claude/OpenAI API and asserts the cached prompt layout.

## [0.1.0] - 2026-10-30

### Added

- Inline completions (ghost text) through `InlineCompletionItemProvider`, accepted with Tab.
- Edit suggestions: select code, give an instruction, review an inline red/green diff, accept with Tab or reject with Esc.
- Anthropic provider (Claude API, default `claude-haiku-5-5` for completions and `claude-sonnet-5-5` for edits) and an OpenAI-compatible provider (Ollama, LM Studio, vLLM, OpenRouter, ...).
- Prompt caching: system prompt and a frozen context snapshot form a stable cached prefix; optional cache pre-warming and keep-alive.
- Configurable system prompts and prompt templates with placeholders.
- API keys stored in VS Code secret storage.
- Status bar item with usage and cache statistics, output channel with optional prompt logging.
- GitHub Actions CI and tag-based release workflow publishing the `.vsix` as a GitHub release.
