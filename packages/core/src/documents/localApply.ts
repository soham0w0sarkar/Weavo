import { generateOperationId } from "../ids";
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
  const node = findByIndex(doc.skipList, position - 1);
  const refNode = node?.refCrdtNode!;

  const opId = generateOperationId(doc.clientId, doc.counter);
  const op = createInsertOperation(opId, content, refNode.id);

  return op;
};
