import {
  createReplica,
  generateClientId,
  onInput as localInput,
  type Operation,
} from "@repo/core";
import { createTransport, createWebSocketTransport } from "@repo/transport";
import { manageTransport } from "./transport";
import { update, type StateVector } from "@repo/sync";
import { createSubscription } from "./Subscription";
import { applyTextChange, toTextChange } from "./textChange";
import { reconcileBefore, type InputSnapshot } from "./inputSnapshot";
import type { TextChange } from "./types";

const captureSnapshot = (el: HTMLTextAreaElement): InputSnapshot => ({
  start: el.selectionStart,
  end: el.selectionEnd,
  value: el.value,
});

export const createRelay = (url: string) => {
  const clientId = generateClientId();

  const doc = createReplica(clientId);
  const sv: StateVector = new Map();
  const rawTransport = createWebSocketTransport(url);
  const transport = createTransport(rawTransport);
  const subscription = createSubscription();

  let before: InputSnapshot | null = null;
  let boundEl: HTMLTextAreaElement | null = null;

  const emitChange = (change: TextChange) => subscription.emit(change);

  const applyRemoteToBound = (change: TextChange) => {
    if (boundEl) boundEl.value = applyTextChange(boundEl.value, change);
    emitChange(change);
  };

  const onApplied = (op: Operation, index: number) => {
    applyRemoteToBound(toTextChange(op, index));
  };

  const processLocalInput = (event: InputEvent) => {
    const applied = localInput(event, doc, before);
    if (!applied) return;
    applied.forEach(({ op, index }) => {
      update(sv, op.type === "insert" ? op.id : op.target);
      emitChange(toTextChange(op, index));
      transport.send({ type: "op", op });
    });
  };

  manageTransport(transport, doc, sv, onApplied);
  transport.connect();

  const bind = (el: HTMLTextAreaElement) => {
    boundEl = el;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Backspace" || event.key === "Delete") {
        before = captureSnapshot(el);
      }
    };

    const onBeforeInput = (event: Event) => {
      before = captureSnapshot(event.target as HTMLTextAreaElement);
    };

    const onInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (!before) return;
      before = reconcileBefore(before, el.value, inputEvent.inputType);
      processLocalInput(inputEvent);
    };

    const refreshSnapshot = () => {
      before = captureSnapshot(el);
    };

    el.addEventListener("keydown", onKeyDown, true);
    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("input", onInput);
    el.addEventListener("click", refreshSnapshot);
    el.addEventListener("select", refreshSnapshot);
    el.addEventListener("keyup", refreshSnapshot);

    return () => {
      el.removeEventListener("keydown", onKeyDown, true);
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("input", onInput);
      el.removeEventListener("click", refreshSnapshot);
      el.removeEventListener("select", refreshSnapshot);
      el.removeEventListener("keyup", refreshSnapshot);
      if (boundEl === el) boundEl = null;
    };
  };

  return {
    bind,
    textSubscribe: subscription.subscribe,
    disconnect: () => transport.disconnect(),
  };
};
