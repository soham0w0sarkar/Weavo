import { generateOperationId, toKey } from "../ids";
import type { InsertOperation } from "../operations/types";
import { createInsertOperation } from "../operations";
import { findByIndex } from "../skipList";
import { apply } from "./apply";
import type { Document } from "./types";

export const onInput = (e: InputEvent, doc: Document) => {
  if (e.inputType === "insertText" || e.inputType === "insertLineBreak") {
    const target = e.target as HTMLTextAreaElement;
    const content = e.data ?? "\n";
    const positionAfter = target.selectionStart ?? 0;
    const position = positionAfter - content.length;

    const op = buildOp(doc, position, content);

    apply(doc, op);
  }
};

export const buildOp = (
  doc: Document,
  position: number,
  content: string,
): InsertOperation => {
  const slNodePred = findByIndex(doc.skipList, position - 1);
  if (!slNodePred) throw new Error("no node found");

  const nodeLeft = doc.store.nodes.get(slNodePred.refCrdtKey);
  if (!nodeLeft) throw new Error("no node found");

  const nodeRight = slNodePred.next[0]
    ? doc.store.nodes.get(slNodePred.next[0].refCrdtKey)
    : null;

  const opId = generateOperationId(doc.clientId, doc.counter);
  const op = createInsertOperation(opId, content, nodeLeft.id, nodeRight?.id);

  return op;
};
