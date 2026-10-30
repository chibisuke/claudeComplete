# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
