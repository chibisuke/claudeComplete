// Minimal stand-in for the `vscode` module in unit tests. Only what the tested modules import.
export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  };
  fire(e: T): void {
    for (const l of this.listeners) {
      l(e);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c as number, d as number);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
}

export class CancellationTokenSource {
  private emitter = new EventEmitter<void>();
  token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event,
  };
  cancel(): void {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
}

export const workspace = {
  asRelativePath: (uri: { path: string }) => uri.path,
  textDocuments: [] as unknown[],
};
export const window = { tabGroups: { all: [] as unknown[] } };
export class TabInputText {}
export class MarkdownString {
  value = "";
  isTrusted: unknown;
  constructor(
    value?: string,
    public supportThemeIcons?: boolean,
  ) {
    this.value = value ?? "";
  }
  appendMarkdown(v: string): this {
    this.value += v;
    return this;
  }
  appendCodeblock(code: string, lang?: string): this {
    this.value += `\n\`\`\`${lang ?? ""}\n${code}\n\`\`\`\n`;
    return this;
  }
}
export class Selection extends Range {}
export const extensions = { getExtension: (_id: string) => undefined as unknown };
export const commands = { executeCommand: async () => undefined };
export const languages = { registerCodeLensProvider: () => ({ dispose() {} }) };
export const OverviewRulerLane = { Left: 1 };
export class ThemeColor {
  constructor(public id: string) {}
}
export class Uri {
  static joinPath(..._p: unknown[]) {
    return new Uri();
  }
}
