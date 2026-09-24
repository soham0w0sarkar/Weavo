import {
  textChangeFromDiff,
  transformPosition,
  transformSnapshot,
  type WeavoAdapter,
  type WeavoAdapterHost,
} from "@weavo/client";
import { reconcileBefore } from "./reconcileBefore";
import { captureSnapshot, type CompositionState } from "./types";

const bindTextarea = (weavo: WeavoAdapterHost, el: HTMLTextAreaElement) => {
  let attached = true;
  const getCursor = () => (attached ? el.selectionStart : 0);
  weavo.setCursorSource(getCursor);

  const text = weavo.getText();
  if (text) {
    el.value = text;
  }
  let before = captureSnapshot(el);
  let pendingInput = false;
  let composition: CompositionState | null = null;

  let unsubJoined: (() => void) | undefined;
  if (!weavo.isJoined()) {
    el.readOnly = true;
    unsubJoined = weavo.onJoined(() => {
      el.readOnly = false;
      unsubJoined?.();
      unsubJoined = undefined;
    });
  } else {
    el.readOnly = false;
  }

  const resolveDelete = (snapshot: typeof before, currentValue: string) => {
    const removed = textChangeFromDiff(snapshot.value, currentValue);
    if (!removed || !removed.delete) return null;
    return {
      start: removed.index,
      end: removed.index + removed.delete,
      value: snapshot.value,
    };
  };

  const commitComposition = (comp: CompositionState) => {
    const tailLength = comp.value.length - comp.end;
    const composedEnd = Math.max(comp.start, el.value.length - tailLength);
    const composed = el.value.slice(comp.start, composedEnd);

    if (composed.length > 0 || comp.docEnd > comp.docStart) {
      weavo.applyLocal(
        { inputType: "insertText", data: composed },
        { start: comp.docStart, end: comp.docEnd, value: weavo.getText() },
      );
    }

    const prev = el.value;
    const selectionStart = el.selectionStart;
    const selectionEnd = el.selectionEnd;
    const synced = weavo.getText();
    const change = textChangeFromDiff(prev, synced);
    el.value = synced;
    if (change) {
      el.selectionStart = transformPosition(selectionStart, change);
      el.selectionEnd = transformPosition(selectionEnd, change);
    }
    before = captureSnapshot(el);
  };

  const unsubRemote = weavo.onRemote(({ change, text: nextText }) => {
    if (composition) {
      composition.docStart = transformPosition(composition.docStart, change);
      composition.docEnd = transformPosition(composition.docEnd, change);
      return;
    }

    const selectionStart = el.selectionStart;
    const selectionEnd = el.selectionEnd;
    el.value = nextText;
    el.selectionStart = transformPosition(selectionStart, change);
    el.selectionEnd = transformPosition(selectionEnd, change);
    before = transformSnapshot(before, change);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (composition) return;
    if (event.key === "Backspace" || event.key === "Delete") {
      before = captureSnapshot(el);
      pendingInput = true;
    }
  };

  const onBeforeInput = (event: Event) => {
    if (!weavo.isJoined()) {
      event.preventDefault();
      return;
    }
    if (composition) return;
    before = captureSnapshot(event.target as HTMLTextAreaElement);
    pendingInput = true;
  };

  const onInput = (event: Event) => {
    const inputEvent = event as InputEvent;
    if (composition || inputEvent.inputType === "insertCompositionText") {
      return;
    }

    if (inputEvent.inputType.startsWith("delete")) {
      const range = resolveDelete(before, el.value);
      if (range) {
        weavo.applyLocal({ inputType: "deleteContentForward" }, range);
      }
      before = captureSnapshot(el);
      pendingInput = false;
      return;
    }

    const snapshot = reconcileBefore(
      before,
      el.value,
      inputEvent.inputType,
      inputEvent.data,
    );
    before = snapshot;
    weavo.applyLocal(
      { inputType: inputEvent.inputType, data: inputEvent.data },
      snapshot,
    );
    pendingInput = false;
  };

  const onCompositionStart = () => {
    if (!weavo.isJoined()) return;
    composition = {
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd,
      docStart: el.selectionStart,
      docEnd: el.selectionEnd,
    };
    pendingInput = false;
  };

  const onCompositionEnd = () => {
    const comp = composition;
    composition = null;
    if (comp) commitComposition(comp);
  };

  const refreshSnapshot = () => {
    if (pendingInput || composition) return;
    before = captureSnapshot(el);
  };

  el.addEventListener("keydown", onKeyDown, true);
  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  el.addEventListener("compositionstart", onCompositionStart);
  el.addEventListener("compositionend", onCompositionEnd);
  el.addEventListener("click", refreshSnapshot);
  el.addEventListener("select", refreshSnapshot);
  el.addEventListener("keyup", refreshSnapshot);

  return () => {
    unsubJoined?.();
    unsubRemote();
    el.removeEventListener("keydown", onKeyDown, true);
    el.removeEventListener("beforeinput", onBeforeInput);
    el.removeEventListener("input", onInput);
    el.removeEventListener("compositionstart", onCompositionStart);
    el.removeEventListener("compositionend", onCompositionEnd);
    el.removeEventListener("click", refreshSnapshot);
    el.removeEventListener("select", refreshSnapshot);
    el.removeEventListener("keyup", refreshSnapshot);
    composition = null;
    attached = false;
  };
};

export const textareaAdapter: WeavoAdapter<HTMLTextAreaElement> = {
  bind: bindTextarea,
};
