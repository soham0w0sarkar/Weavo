import { describe, expect, test } from "bun:test";
import { onBeforeInput } from "../src/documents/localApply";
import type { Before } from "../src/documents/types";

const inputEvent = (target: {
  selectionStart: number | null;
  selectionEnd: number | null;
  value: string;
}) => ({ target }) as unknown as InputEvent;

describe("onBeforeInput", () => {
  test("returns the pre-input selection and value", () => {
    const event = inputEvent({
      selectionStart: 1,
      selectionEnd: 3,
      value: "hello",
    });

    expect(onBeforeInput(event)).toEqual({
      start: 1,
      end: 3,
      value: "hello",
    });
  });

  test("fills a caller-provided snapshot in place", () => {
    const before: Before = { start: 0, end: 0, value: "" };
    const event = inputEvent({
      selectionStart: 2,
      selectionEnd: 4,
      value: "hello",
    });

    const snapshot = onBeforeInput(event, before);

    expect(snapshot).toEqual({ start: 2, end: 4, value: "hello" });
    expect(before).toEqual({ start: 2, end: 4, value: "hello" });
  });

  test("normalizes missing selections to zero", () => {
    const event = inputEvent({
      selectionStart: null,
      selectionEnd: null,
      value: "",
    });

    expect(onBeforeInput(event)).toEqual({ start: 0, end: 0, value: "" });
  });
});
