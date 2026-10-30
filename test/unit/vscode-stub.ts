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
