import { generateOperationId, toKey } from "../ids";
import {
  createDeleteOperation,
  createInsertOperation,
  type Operation,
} from "../operations";
import { findByIndex } from "../skipList";
import { apply } from "./apply";
import type { Before, Document } from "./types";

const buildOpFromLocalInput = (
  doc: Document,
  insertedText: string,
  insertedLength: number,
  deletedLength: number,
  position: number,
): Operation[] => {
  const op = [];
  for (let i = 0; i < insertedLength; i++) {
    op.push(buildOp(doc, position + i, "ins", insertedText[i]));
  }
  for (let i = 0; i < deletedLength; i++) {
    op.push(buildOp(doc, position + i, "del"));
  }

  return op;
};

export const onBeforeInput = (e: InputEvent, before: Before) => {
  const target = e.target as HTMLTextAreaElement;

  before = {
    start: target.selectionStart,
    end: target.selectionEnd,
    value: target.value,
  };
};

export const onInput = (
  e: InputEvent,
  doc: Document,
  before: Before,
): Operation[] | null => {
  if (!before) return null;

  const target = e.target as HTMLTextAreaElement;

  const selectedText = before.value.slice(before.start, before.end);

  const deletedLength = before.end - before.start;

  const insertedText =
    e.inputType === "insertLineBreak" ? "\n" : (e.data ?? "");

  switch (e.inputType) {
    case "insertText":
    case "insertLineBreak":
    case "insertFromPaste": {
      const ops = buildOpFromLocalInput(
        doc,
        insertedText,
        insertedText.length,
        deletedLength,
        before.start,
      );

      ops.map((op) => apply(doc, op));

      return ops;
    }

    case "deleteContentBackward":
    case "deleteContentForward":
    case "deleteByCut": {
      const ops = buildOpFromLocalInput(
        doc,
        "",
        0,
        deletedLength > 0 ? deletedLength : 1,
        e.inputType === "deleteContentBackward"
          ? before.start - 1
          : before.start,
      );

      ops.map((op) => apply(doc, op));

      return ops;
    }

    default:
      return null;
  }
};

export const buildOp = (
  doc: Document,
  position: number,
  type: "del" | "ins",
  content: string | null = null,
): Operation => {
  if (type === "ins") {
    const predIndex = position - 1;
    const slNodePred =
      predIndex < 0
        ? doc.skipList.head
        : findByIndex(doc.skipList, predIndex);
    if (!slNodePred) throw new Error("no node found");

    const nodeLeft = doc.store.nodes.get(slNodePred.refCrdtKey);
    if (!nodeLeft) throw new Error("no node found");

    const nodeRight = slNodePred.next[0]
      ? doc.store.nodes.get(slNodePred.next[0].refCrdtKey)
      : null;

    const opId = generateOperationId(doc.clientId, doc.counter);
    const op = createInsertOperation(
      opId,
      content!,
      nodeLeft.id,
      nodeRight?.id,
    );

    return op;
  } else {
    const slNodePred = findByIndex(doc.skipList, position);
    if (!slNodePred) throw new Error("no node found");

    const node = doc.store.nodes.get(slNodePred.refCrdtKey);
    if (!node) throw new Error("no node found");

    const op = createDeleteOperation(node.id);
    return op;
  }
};
