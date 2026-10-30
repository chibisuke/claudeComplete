# Konzept: „claudeComplete“ – VS Code Extension für Inline-Completions und Edit-Vorschläge

## Context

Das Repo `chibisuke/claudecomplete` ist aktuell leer (nur README). Ziel ist eine VS Code Extension mit Copilot-ähnlicher Funktionalität:

- **Inline-Completions** (Ghost Text, mit Tab übernehmen) während des Tippens
- **Edit-Vorschläge** (Code markieren + Anweisung → Diff im Editor, Accept/Reject per Tastendruck)
- **Claude API** als primärer Backend (Haiku 5.5 für Completions, Sonnet 5.5 für Edits), **Provider und Modell einstellbar**
- **OpenAI-kompatible APIs** als zweiter Provider (Ollama, LM Studio, vLLM, OpenRouter, …)
- **System-Prompt und Prompt-Template** vom Nutzer anpassbar
- **Build + Release über GitHub Actions**, `.vsix` als GitHub Release (Marketplace optional)

Entscheidungen, die ich getroffen habe (bitte widersprechen, wenn anders gewünscht):
- Sprache **TypeScript**, Bundling mit **esbuild**, Tests mit **vitest** (+ minimaler `@vscode/test-electron`-Smoke-Test).
- Extension-ID `claudecomplete`, Display-Name „ClaudeComplete“, Settings-Prefix `claudeComplete.*`.
- Kein Chat-Panel im ersten Wurf (steht als „später“ unten).
- API-Keys landen in `vscode.SecretStorage`, nie in `settings.json`.

---

## 1. Architektur

```
src/
  extension.ts              # activate(): registriert Provider, Commands, Statusbar
  config.ts                 # typisierter Zugriff auf claudeComplete.* Settings + Change-Events
  secrets.ts                # API-Key-Handling über SecretStorage, Command "Set API Key"
  llm/
    types.ts                # LLMProvider-Interface, CompletionRequest, Chunk-Typen
    anthropic.ts            # Provider über @anthropic-ai/sdk (Streaming, Caching, effort)
    openaiCompat.ts         # Provider über fetch auf /v1/chat/completions (SSE-Streaming)
    factory.ts              # wählt Provider anhand Settings
  completion/
    inlineProvider.ts       # vscode.InlineCompletionItemProvider
    contextBuilder.ts       # Prefix/Suffix, Sprache, Dateiname, Kontext aus offenen Tabs
    prompt.ts               # rendert System-Prompt + Template mit Platzhaltern
    postprocess.ts          # Code-Fences entfernen, Suffix-Overlap kürzen, Leerzeilen trimmen
    cache.ts                # LRU-Cache (Key: Hash von Prefix/Suffix) + Debounce/Cancel
  edit/
    editCommand.ts          # Command "Edit selection with instruction"
    diffPreview.ts          # Inline-Diff per Decorations (rot/grün), Accept/Reject, CodeLens
    prompt.ts               # Edit-Prompt (Selection + Instruction + Umgebung)
  ui/
    statusBar.ts            # Status (idle/loading/error/disabled), Klick = Toggle
    log.ts                  # OutputChannel "ClaudeComplete", Debug-Logging der Prompts
test/
  unit/                     # vitest: prompt.ts, postprocess.ts, SSE-Parser, config
  e2e/                      # @vscode/test-electron: Extension aktiviert, Commands vorhanden
.github/workflows/
  ci.yml                    # PR/Push: lint, typecheck, test, vsce package (Artifact)
  release.yml               # Tag v*: build, package, GitHub Release mit .vsix, optional Marketplace
```

### Provider-Abstraktion (`src/llm/types.ts`)

```ts
interface LLMProvider {
  stream(req: LLMRequest, token: vscode.CancellationToken): AsyncIterable<string>;
}
interface LLMRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  stop?: string[];
}
```

- **AnthropicProvider**: `new Anthropic({ apiKey, baseURL })` (baseURL optional für Proxies). `client.messages.stream({...})`, Text-Deltas yielden. System-Prompt mit `cache_control: { type: "ephemeral" }` (stabil, steht vorn → Prompt-Caching greift). `output_config: { effort: "low" }` für Completions, `"medium"` für Edits. Kein `temperature` senden (ab API-Version 2026-10-21 nicht mehr erlaubt). `AbortSignal` aus dem VS Code `CancellationToken` ableiten. `stop_reason: "refusal"` abfangen und leer zurückgeben. Fehlerkette: `AuthenticationError` → Hinweis „API Key setzen“, `RateLimitError` → Backoff, Rest → Statusbar-Error.
- **OpenAICompatProvider**: `fetch(baseUrl + "/chat/completions", { stream: true })`, SSE-Parser für `data:` Zeilen, `choices[0].delta.content`. Eigener API-Key-Slot im SecretStorage. Funktioniert ohne Key (Ollama).

### Inline-Completions (`src/completion/`)

- `vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider)`.
- Ablauf in `provideInlineCompletionItems`: Toggle/Sprache prüfen → Cache-Lookup → Debounce (Setting, Default 300 ms) → Request abbrechen, wenn `token` gecancelt → Prompt bauen → Stream einsammeln (erstes Ergebnis komplett, kein partielles Ghost-Text-Update nötig) → Postprocess → `InlineCompletionItem` mit `range` = Cursorposition bis Zeilenende (erlaubt Ersetzen des Restes der Zeile).
- **Kontext**: `prefix` = N Zeilen vor Cursor (Setting `contextLinesBefore`, Default 100), `suffix` = M Zeilen danach (Default 30), Sprache, relativer Dateiname, optional Snippets anderer offener Tabs gleicher Sprache (Setting, Default an, max. ~2000 Zeichen).
- **Prompt-Template** mit Platzhaltern `{prefix}`, `{suffix}`, `{language}`, `{filename}`, `{context}`. Default-Template bittet um reinen Code, der an `{prefix}` anschließt und vor `{suffix}` endet, ohne Markdown, ohne Erklärung. Multi-Line nur, wenn der Cursor am Zeilenende steht (Setting `multiline`: `auto|always|never`).
- **Postprocess**: Code-Fences strippen, führenden Text entfernen, der bereits in der aktuellen Zeile steht, Overlap mit Suffix abschneiden, bei `multiline=never` erste Zeile nehmen.
- Cache nach Dokument-URI + Prefix-Hash; Cache-Treffer sofort ohne API-Call.
- Nutzung von `vscode.InlineCompletionContext.selectedCompletionInfo`, um bei offenem IntelliSense-Popup den Vorschlag konsistent zu halten.

### Edit-Vorschläge (`src/edit/`)

- Command `claudeComplete.editSelection` (Keybinding `Ctrl+Shift+I` / `Cmd+Shift+I`, Kontextmenü): Selection (oder aktuelle Funktion/Block, wenn nichts markiert) + `showInputBox` für die Anweisung.
- Prompt: System-Prompt für Edits + Template mit `{selection}`, `{instruction}`, `{language}`, `{filename}`, `{before}`, `{after}`. Modell antwortet nur mit dem ersetzten Code.
- **Diff-Preview im Editor** (kein separates Diff-Fenster): entfernte Zeilen als rote Decoration (durchgestrichen), neue Zeilen als grüne `after`-Decorations bzw. temporär eingefügter Text, berechnet mit `diff` (npm). Darüber ein CodeLens „✓ Accept (Tab) · ✗ Reject (Esc)“ plus Commands `claudeComplete.acceptEdit` / `claudeComplete.rejectEdit` mit `when`-Context `claudeComplete.editPending`.
- Accept → `WorkspaceEdit` anwenden (einziger Undo-Schritt); Reject → Decorations entfernen. Dokumentwechsel oder Edit durch den Nutzer verwirft den Vorschlag.
- Zweites Modell-Setting (`editModel`, Default `claude-sonnet-5-5`), weil Edits mehr Qualität brauchen als Completions.

### Prompt-Caching: vorkonstruierter, wiederverwendbarer Kontext (`src/llm/cacheLayout.ts`, `src/completion/contextSnapshot.ts`)

Die Claude API bietet dafür **Prompt Caching** (`cache_control: {type: "ephemeral"}`): ein Präfix des Prompts wird serverseitig gecacht und bei jedem Folge-Request, der byte-identisch mit demselben Präfix beginnt, nur noch zu ~10 % des Preises gelesen (Cache-Write 1,25× bei 5 min TTL, 2× bei 1 h TTL; Mindestgröße 512 Tokens bei Haiku 5.5 / Sonnet 5.5; max. 4 Breakpoints). Darauf wird die ganze Prompt-Struktur ausgelegt, damit die vielen kleinen Completion-Calls nicht jedes Mal den vollen Kontext bezahlen:

**Drei-Schichten-Prompt (stabil → volatil):**

1. **System-Prompt** (ändert sich nie während der Session) → Breakpoint 1, optional `ttl: "1h"`.
2. **Kontext-Snapshot** (ändert sich selten) → Breakpoint 2 (5 min TTL). Enthält: kompletten Inhalt der aktuellen Datei als „Snapshot zum Zeitpunkt T“, Snippets anderer offener Tabs, ggf. Projekt-Hinweise (Framework, Imports). Wird als eigener System-Textblock *vor* dem Breakpoint gerendert, damit er mit dem System-Prompt zusammen gecacht wird.
3. **Volatiler Tail** (jeder Tastendruck): nur das kleine Fenster um den Cursor (`{prefix}`/`{suffix}`, z. B. 30/15 Zeilen) plus Cursor-Position als User-Message. Kein Breakpoint – wird jedes Mal frisch verarbeitet, ist aber klein.

**Snapshot-Lebenszyklus (`ContextSnapshot`):**
- Wird pro Dokument angelegt bei Fokuswechsel/Öffnen und eingefroren (byte-stabil, keine Zeitstempel, deterministische Reihenfolge der Tabs).
- Refresh nur bei: Dateiwechsel, Speichern, mehr als N geänderten Zeilen außerhalb des Cursor-Fensters (Setting, Default 20) oder Ablauf von `snapshotMaxAgeSec` (Default 120). Bis dahin bleibt der Prompt-Präfix identisch → Cache-Hits auf Schicht 1 + 2.
- Das Modell wird im Template explizit instruiert: „Der Snapshot kann leicht veraltet sein; der Code um den Cursor im letzten Abschnitt ist maßgeblich.“
- Größenlimit `snapshotMaxTokens` (Default 8000): große Dateien werden um den Cursor herum beschnitten (Kopf der Datei mit Imports bleibt immer drin).

**Pre-Warming und Keep-Alive:**
- Bei Snapshot-Erzeugung sofort ein Request mit `max_tokens: 0` (schreibt den Cache, kostet keine Output-Tokens, kein Streaming) → die erste echte Completion nach einem Dateiwechsel trifft bereits den Cache. Setting `cache.prewarm` (Default an).
- Optionaler Keep-Alive: wenn länger als ~4 min keine Completion lief und der Editor fokussiert ist, denselben `max_tokens: 0`-Request erneut senden (verlängert TTL zum Lesepreis). Setting `cache.keepAlive` (Default aus, da es bei langen Pausen Kosten erzeugt).

**Edits teilen den Kontext:** Der Edit-Command nutzt dasselbe Layout (System-Prompt für Edits + identischer Snapshot-Block). Hinweis: Caches sind pro Modell getrennt – wer Completions und Edits im Cache teilen will, setzt beide auf dasselbe Modell; der Default (Haiku für Completions, Sonnet für Edits) bedeutet zwei getrennte Caches.

**Beobachtbarkeit:** `usage.cache_read_input_tokens` / `cache_creation_input_tokens` / `input_tokens` jeder Antwort werden gezählt; Statusbar-Tooltip zeigt Cache-Hit-Rate und Tokens der Session, OutputChannel loggt pro Request die drei Werte. Ein Unit-Test prüft, dass zwei aufeinanderfolgende Renderings bei unverändertem Snapshot byte-identische Präfixe liefern (Regressionsschutz gegen „stille Invalidierer“).

**OpenAI-kompatibler Provider:** kein explizites `cache_control`, aber dieselbe Schichtung wird beibehalten, weil OpenAI, DeepSeek u. a. automatisches Prefix-Caching machen und Ollama/vLLM den KV-Cache für identische Präfixe wiederverwenden. Der Provider ignoriert die Breakpoint-Marker einfach.

Settings dafür: `claudeComplete.cache.enabled` (true), `cache.systemPromptTtl` (`5m`|`1h`, Default `5m`), `cache.prewarm` (true), `cache.keepAlive` (false), `cache.snapshotMaxTokens` (8000), `cache.snapshotRefreshLines` (20), `cache.snapshotMaxAgeSec` (120).

### Settings (`package.json` → `contributes.configuration`)

| Setting | Default | Beschreibung |
|---|---|---|
| `claudeComplete.enabled` | `true` | Globaler Schalter (auch über Statusbar) |
| `claudeComplete.provider` | `"anthropic"` | `anthropic` \| `openai-compatible` |
| `claudeComplete.anthropic.baseUrl` | `""` | Optionaler Proxy/Gateway |
| `claudeComplete.openai.baseUrl` | `"http://localhost:11434/v1"` | Ollama-Default |
| `claudeComplete.completion.model` | `"claude-haiku-5-5"` | Modell für Inline-Completions |
| `claudeComplete.edit.model` | `"claude-sonnet-5-5"` | Modell für Edit-Vorschläge |
| `claudeComplete.completion.maxTokens` | `256` | |
| `claudeComplete.edit.maxTokens` | `4096` | |
| `claudeComplete.completion.debounceMs` | `300` | |
| `claudeComplete.completion.multiline` | `"auto"` | `auto` \| `always` \| `never` |
| `claudeComplete.completion.contextLinesBefore/After` | `100` / `30` | |
| `claudeComplete.completion.includeOpenTabs` | `true` | |
| `claudeComplete.completion.systemPrompt` | (Default-Text) | Frei editierbar, mehrzeilig |
| `claudeComplete.completion.promptTemplate` | (Default-Text) | Platzhalter siehe oben |
| `claudeComplete.edit.systemPrompt` | (Default-Text) | |
| `claudeComplete.edit.promptTemplate` | (Default-Text) | |
| `claudeComplete.disabledLanguages` | `["plaintext","markdown"]` | |
| `claudeComplete.logPrompts` | `false` | Prompts im OutputChannel loggen |

Commands: `setApiKey` (Provider-abhängig, Passwort-Input), `toggle`, `editSelection`, `acceptEdit`, `rejectEdit`, `showLogs`, `resetPrompts`.

---

## 2. Build, CI und Release

- **Tooling**: `npm`, `typescript`, `esbuild` (ein Bundle `dist/extension.js`, `vscode` extern), `eslint` + `prettier`, `vitest`, `@vscode/vsce`, `@vscode/test-electron`.
- **`ci.yml`** (push auf `main` + PRs): `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npx vsce package` → `.vsix` als Workflow-Artifact hochladen. Node 20, ubuntu-latest; e2e-Test unter `xvfb-run`.
- **`release.yml`** (Tag `v*.*.*`): gleiche Checks → Version aus Tag gegen `package.json` prüfen → `vsce package` → `softprops/action-gh-release` erzeugt Release mit `.vsix` und generierten Notes. Optionaler Step `vsce publish` nur wenn Secret `VSCE_PAT` existiert, analog `ovsx publish` mit `OVSX_PAT` für Open VSX.
- Installationshinweis in README: `.vsix` herunterladen → „Install from VSIX…“.
- `CHANGELOG.md` nach Keep-a-Changelog, Version-Bump per `npm version` + Tag-Push.

---

## 3. Umsetzungsschritte (Milestones)

1. **Scaffold**: `package.json` (Manifest, Settings, Commands, Keybindings, Menüs), `tsconfig`, esbuild-Script, eslint/prettier, vitest, `.vscodeignore`, `.gitignore`, README, LICENSE (MIT), `ci.yml`.
2. **Provider-Layer**: `types.ts`, `anthropic.ts`, `openaiCompat.ts`, `factory.ts`, `secrets.ts`, `config.ts`; Unit-Tests für SSE-Parser und Fehler-Mapping (API gemockt).
3. **Inline-Completions**: `contextBuilder`, `contextSnapshot`, `cacheLayout` (Drei-Schichten-Prompt mit `cache_control`-Breakpoints, Pre-Warm mit `max_tokens: 0`), `prompt`, `postprocess`, `cache`, `inlineProvider`; Statusbar + Logging inkl. Cache-Statistik. Unit-Tests für Template-Rendering, Postprocess (Fences, Suffix-Overlap, Multiline) und byte-identische Präfixe bei unverändertem Snapshot.
4. **Edit-Vorschläge**: `editCommand`, `prompt`, `diffPreview`, Accept/Reject-Commands und `when`-Contexts; Unit-Test für Diff→Decoration-Mapping.
5. **Release-Pipeline**: `release.yml`, CHANGELOG, Versionierung, erstes Release `v0.1.0`.
6. **Feinschliff**: Standardprompts tunen (Haiku 5.5 neigt zu Erklärtext → strikte „nur Code“-Anweisung + Stop-Sequenzen wie ```` ``` ````), Telemetrie bewusst *nicht* einbauen, Dokumentation der Platzhalter.

Später denkbar (nicht Teil dieses Plans): Chat-Sidebar, „Next Edit Suggestions“ (proaktive Edits nach dem Tippen), Bedrock/Vertex-Clients, Workspace-weite Kontextsuche.

---

## 4. Verifikation

- `npm run lint && npm run typecheck && npm test` lokal grün; CI-Workflow auf einem PR grün.
- `npx vsce package` erzeugt eine `.vsix`; Installation in VS Code über „Install from VSIX“.
- Manuell im Extension Development Host (F5):
  - API-Key über Command setzen, in einer `.ts`-Datei tippen → Ghost Text erscheint, Tab übernimmt, Esc verwirft.
  - Provider auf `openai-compatible` mit laufendem Ollama umstellen → Completions funktionieren ohne Key.
  - Selection + `Ctrl+Shift+I` + Anweisung → roter/grüner Inline-Diff, Tab übernimmt als ein Undo-Schritt, Esc verwirft.
  - System-Prompt in Settings ändern, `logPrompts` an → geänderter Prompt im OutputChannel sichtbar.
  - Falscher Key → Statusbar zeigt Fehler, Klick öffnet „Set API Key“.
  - Caching: Datei öffnen → im OutputChannel erscheint der Pre-Warm-Request mit `cache_creation_input_tokens > 0`; die nächsten Completions zeigen `cache_read_input_tokens` in Höhe von System-Prompt + Snapshot und nur ein kleines `input_tokens`. Nach > 20 geänderten Zeilen außerhalb des Fensters wird ein neuer Snapshot geschrieben (einmaliger Cache-Write, danach wieder Reads).
- Tag `v0.1.0` pushen → `release.yml` erstellt GitHub Release mit angehängter `.vsix`.
