import { describe, expect, it } from "vitest";
import { findCitations } from "@/platform/agent/runtime";

describe("citation guard", () => {
  it("extracts single and grouped clause references", () => {
    expect(findCitations("Penalty-free [POL-PL-003], allowed after [POL-PL-001, POL-PL-004].")).toEqual(["POL-PL-003", "POL-PL-001", "POL-PL-004"]);
  });
  it("catches fabricated IDs so they can be flagged", () => {
    const known = new Set(["POL-PL-006", "POL-PL-008"]);
    expect(findCitations("outside the window [POL-PAY-04]").filter((id) => !known.has(id))).toEqual(["POL-PAY-04"]);
  });
});
