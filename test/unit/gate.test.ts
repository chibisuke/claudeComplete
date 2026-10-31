import { describe, expect, it } from "vitest";
import {
  ManualTrigger,
  shouldServe,
  TRIGGER_AUTOMATIC,
  TRIGGER_INVOKE,
} from "../../src/completion/gate";

describe("shouldServe", () => {
  it("serves everything when automatic completions are on", () => {
    expect(
      shouldServe({ enabled: true, triggerKind: TRIGGER_AUTOMATIC, manualPending: false }),
    ).toBe(true);
    expect(shouldServe({ enabled: true, triggerKind: TRIGGER_INVOKE, manualPending: false })).toBe(
      true,
    );
  });
  it("blocks typing and the editor's own trigger when off", () => {
    expect(
      shouldServe({ enabled: false, triggerKind: TRIGGER_AUTOMATIC, manualPending: false }),
    ).toBe(false);
    expect(shouldServe({ enabled: false, triggerKind: TRIGGER_INVOKE, manualPending: false })).toBe(
      false,
    );
    expect(
      shouldServe({ enabled: false, triggerKind: TRIGGER_AUTOMATIC, manualPending: true }),
    ).toBe(false);
  });
  it("serves an announced manual request when off", () => {
    expect(shouldServe({ enabled: false, triggerKind: TRIGGER_INVOKE, manualPending: true })).toBe(
      true,
    );
  });
});

describe("ManualTrigger", () => {
  it("is consumed once and only for the armed document", () => {
    const t = new ManualTrigger(1000);
    t.arm("file:///a", 0);
    expect(t.isPending("file:///b", 10)).toBe(false);
    expect(t.consume("file:///a", 10)).toBe(true);
    expect(t.consume("file:///a", 20)).toBe(false);
  });
  it("expires", () => {
    const t = new ManualTrigger(1000);
    t.arm("file:///a", 0);
    expect(t.consume("file:///a", 2000)).toBe(false);
  });
});
