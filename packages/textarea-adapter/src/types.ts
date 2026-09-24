import type { InputSnapshot } from "@weavo/client";

export type CompositionState = {
  value: string;
  start: number;
  end: number;
  docStart: number;
  docEnd: number;
};

export const captureSnapshot = (el: HTMLTextAreaElement): InputSnapshot => ({
  start: el.selectionStart,
  end: el.selectionEnd,
  value: el.value,
});
