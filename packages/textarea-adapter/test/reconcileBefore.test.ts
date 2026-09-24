import { describe, expect, test } from "bun:test";
import { reconcileBefore } from "../src/reconcileBefore";

describe("reconcileBefore", () => {
  test("returns the same snapshot when only the local edit happened", () => {
    const before = { start: 5, end: 5, value: "aXYbcdef" };

    expect(reconcileBefore(before, "aXYbcZdef", "insertText", "Z")).toBe(
      before,
    );

    expect(
      reconcileBefore(before, "aXYbdef", "deleteContentBackward", null),
    ).toBe(before);
  });

  test("adjusts positions when remote drift slips through before input", () => {
    const before = { start: 3, end: 3, value: "abcdef" };
    const afterRemoteInsert = "aXYbcZdef";

    expect(
      reconcileBefore(before, afterRemoteInsert, "insertText", "Z"),
    ).toEqual({
      start: 5,
      end: 5,
      value: "aXYbcdef",
    });
  });
});
