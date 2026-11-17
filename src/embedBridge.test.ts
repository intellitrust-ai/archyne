import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGraphStore } from "./store";

// The bridge as a host sees it: messages to a fake parent window.
const ORIGIN = "http://host.test";
const sent: Record<string, unknown>[] = [];
const parent = { postMessage: (msg: Record<string, unknown>) => sent.push(msg) };

function fromHost(data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", { data, origin: ORIGIN, source: parent as unknown as Window }),
  );
}

const types = () => sent.map((m) => m.type);
const changes = () => sent.filter((m) => m.type === "change").map((m) => m.code);

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  history.replaceState(null, "", `/?embed=1&origin=${encodeURIComponent(ORIGIN)}`);
  sent.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("embed bridge `change`", () => {
  it("is not sent for Archyne's own starting diagram, nor for the loaded text", async () => {
    const { initEmbedBridge } = await import("./embed");
    initEmbedBridge();
    expect(types()).toEqual(["ready"]);

    // The starting diagram lands before the host's load: not an edit.
    await useGraphStore.getState().applyCode('flowchart TD\n  s["Sample"] --> t["Two"]\n');
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual([]);

    const doc = 'flowchart TD\n  h["Host"] --> d["Doc"]\n';
    fromHost({ type: "load", code: doc });
    await vi.waitFor(() => expect(types()).toContain("loaded"));
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual([]);

    // A real edit afterwards is sent.
    const edited = 'flowchart TD\n  h["Host"] --> d["Edited"]\n';
    await useGraphStore.getState().applyCode(edited);
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual([edited]);
  });
});
