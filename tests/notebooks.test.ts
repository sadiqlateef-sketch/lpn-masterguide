import { describe, expect, it } from "vitest";
import { NOTEBOOK_COLORS } from "@/lib/api-types";
import { cleanNotebookColor, cleanNotebookName, nextColor } from "@/lib/server/notebooks";

describe("notebooks", () => {
  it("tidies names and refuses empty or long ones", () => {
    expect(cleanNotebookName("  Pharm   notebook ")).toBe("Pharm notebook");
    expect(() => cleanNotebookName("   ")).toThrow(/name/);
    expect(() => cleanNotebookName(42)).toThrow(/name/);
    expect(() => cleanNotebookName("x".repeat(81))).toThrow(/too long/);
  });

  it("accepts only the notebook colors", () => {
    expect(cleanNotebookColor(undefined)).toBeUndefined();
    expect(cleanNotebookColor("sky")).toBe("sky");
    expect(() => cleanNotebookColor("plaid")).toThrow(/colors/);
  });

  it("gives a new notebook the first unused color, then cycles", () => {
    expect(nextColor([])).toBe(NOTEBOOK_COLORS[0]);
    expect(nextColor(["violet", "sky"])).toBe("emerald");
    expect(nextColor([...NOTEBOOK_COLORS])).toBe(NOTEBOOK_COLORS[0]);
  });
});
