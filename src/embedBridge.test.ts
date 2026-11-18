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

describe("embed bridge, overlapping and slow loads", () => {
  // A fresh store and bridge per test, talking to a fresh parent: the bridges
  // started by earlier tests listen to the old one and ignore these messages.
  let store: typeof useGraphStore;
  let host: { postMessage: (msg: Record<string, unknown>) => void };
  const send = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: ORIGIN, source: host as unknown as Window }),
    );

  /** Replace `applyCode` with one the test finishes by hand. */
  function slowLoads() {
    // `finish(false)` ends it as the real one ends an overtaken call: without
    // touching the document.
    const pending: Array<{ finish: (apply?: boolean) => void }> = [];
    store.setState({
      applyCode: (code: string) =>
        new Promise<void>((resolve) => {
          pending.push({
            finish: (apply = true) => {
              if (apply) store.setState({ code });
              resolve();
            },
          });
        }),
    });
    return pending;
  }

  beforeEach(async () => {
    vi.resetModules();
    host = { postMessage: (msg) => sent.push(msg) };
    Object.defineProperty(window, "parent", { value: host, configurable: true });
    store = (await import("./store")).useGraphStore;
    (await import("./embed")).initEmbedBridge();
    sent.length = 0;
  });

  it("drops an edit still pending when a load starts, even if the load is slow", async () => {
    const pending = slowLoads();
    send({ type: "load", code: "flowchart TD\n  a --> b\n" });
    pending[0].finish();
    await vi.waitFor(() => expect(types()).toContain("loaded"));

    store.setState({ code: "flowchart TD\n  a --> edited\n" });
    send({ type: "load", code: "flowchart TD\n  x --> y\n" });
    // The debounce elapses while the second load is still laying out.
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual([]);

    pending[1].finish();
    await vi.waitFor(() => expect(types().filter((t) => t === "loaded")).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual([]);
  });

  it("sends edits to a load that overtook a slower one", async () => {
    const pending = slowLoads();
    send({ type: "load", code: "flowchart TD\n  slow --> a\n" });
    send({ type: "load", code: "flowchart TD\n  fast --> b\n" });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    pending[1].finish();
    await vi.waitFor(() => expect(types()).toContain("loaded"));
    const edited = "flowchart TD\n  fast --> edited\n";
    store.setState({ code: edited });

    // The overtaken load finishing late must not swallow that edit.
    pending[0].finish(false);
    await vi.waitFor(() => expect(types().filter((t) => t === "loaded")).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual([edited]);
  });
});
