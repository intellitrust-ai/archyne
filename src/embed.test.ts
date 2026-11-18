import { afterEach, describe, expect, it } from "vitest";
import { ANY_ORIGIN, parseAllowedOrigins } from "./embed";

describe("embed origin allowlist", () => {
  it("refuses to start without an origin parameter", () => {
    // The important case: an embedder that says nothing gets no bridge,
    // rather than one that answers whichever page framed it.
    expect(parseAllowedOrigins("?embed=1")).toBeNull();
    expect(parseAllowedOrigins("")).toBeNull();
    expect(parseAllowedOrigins("?embed=1&origin=")).toBeNull();
    expect(parseAllowedOrigins("?embed=1&origin=%20%20")).toBeNull();
  });

  it("accepts a single origin", () => {
    expect(parseAllowedOrigins("?embed=1&origin=https://app.example")).toEqual([
      "https://app.example",
    ]);
  });

  it("accepts several comma-separated origins", () => {
    expect(
      parseAllowedOrigins("?embed=1&origin=https://a.example,https://b.example:8443"),
    ).toEqual(["https://a.example", "https://b.example:8443"]);
  });

  it("keeps the explicit wildcard as an opt-in", () => {
    expect(parseAllowedOrigins("?embed=1&origin=*")).toBe(ANY_ORIGIN);
  });

  it("tolerates a single trailing slash", () => {
    expect(parseAllowedOrigins("?embed=1&origin=https://app.example/")).toEqual([
      "https://app.example",
    ]);
  });

  it("drops entries that are not bare origins", () => {
    // A path means the host meant something other than an origin; matching it
    // against `event.origin` could never succeed, so it must not silently
    // count as an allowlist entry.
    expect(parseAllowedOrigins("?embed=1&origin=https://app.example/editor")).toBeNull();
    expect(parseAllowedOrigins("?embed=1&origin=not-a-url")).toBeNull();
    expect(parseAllowedOrigins("?embed=1&origin=app.example")).toBeNull();
  });

  it("keeps the valid entries when only some are malformed", () => {
    expect(
      parseAllowedOrigins("?embed=1&origin=nonsense,https://good.example,also bad"),
    ).toEqual(["https://good.example"]);
  });

  it("does not treat a malformed list as a wildcard", () => {
    const result = parseAllowedOrigins("?embed=1&origin=nonsense");
    expect(result).not.toBe(ANY_ORIGIN);
    expect(result).toBeNull();
  });
});

describe("embed drag-to-pan option", () => {
  const at = (search: string) => history.replaceState(null, "", `/${search}`);
  afterEach(() => at(""));

  it("is asked for with `pan=drag`, and only when embedded", async () => {
    const { embedDragPans } = await import("./embed");
    at("?embed=1&origin=https://app.example&pan=drag");
    expect(embedDragPans()).toBe(true);
    // The standalone app keeps its own gestures whatever the URL says.
    at("?pan=drag");
    expect(embedDragPans()).toBe(false);
    at("?embed=1&origin=https://app.example");
    expect(embedDragPans()).toBe(false);
    at("?embed=1&origin=https://app.example&pan=other");
    expect(embedDragPans()).toBe(false);
  });
});
