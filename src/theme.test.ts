import { describe, expect, it } from "vitest";
import { initialChoice } from "./theme";

describe("initial theme", () => {
  it("keeps a saved choice", () => {
    for (const framed of [false, true]) {
      expect(initialChoice("light", framed)).toBe("light");
      expect(initialChoice("dark", framed)).toBe("dark");
      expect(initialChoice("system", framed)).toBe("system");
    }
  });

  it("starts dark without a saved choice", () => {
    expect(initialChoice(null, false)).toBe("dark");
    expect(initialChoice("sepia", false)).toBe("dark");
  });

  it("follows the framing page when embedded in an iframe", () => {
    // Inside an iframe `prefers-color-scheme` is the host's `color-scheme`, so
    // "system" is the host's theme.
    expect(initialChoice(null, true)).toBe("system");
    expect(initialChoice("sepia", true)).toBe("system");
  });
});
