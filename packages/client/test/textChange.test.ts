import { describe, expect, test } from "bun:test";
import { textChangeFromDiff } from "../src/textChange";

describe("textChangeFromDiff", () => {
  test("detects a middle insert", () => {
    expect(textChangeFromDiff("hello", "hXXello")).toEqual({
      index: 1,
      insert: "XX",
    });
  });

  test("detects a middle delete", () => {
    expect(textChangeFromDiff("hello", "hllo")).toEqual({
      index: 1,
      delete: 1,
    });
  });
});
