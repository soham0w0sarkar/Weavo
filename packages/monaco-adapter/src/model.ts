import {
  transformPosition,
  type TextChange,
  type WeavoAdapterHost,
} from "@weavo/client";
import type { editor } from "monaco-editor";
import type { MonacoEditor, MonacoModel, TextEdit } from "./types";

type OffsetSelection = {
  anchor: number;
  active: number;
};

const clampOffset = (model: MonacoModel, offset: number) =>
  Math.max(0, Math.min(offset, model.getValueLength()));

export const captureSelections = (
  target: MonacoEditor,
  model: MonacoModel,
): OffsetSelection[] =>
  (target.getSelections() ?? []).map((selection) => ({
    anchor: model.getOffsetAt({
      lineNumber: selection.selectionStartLineNumber,
      column: selection.selectionStartColumn,
    }),
    active: model.getOffsetAt({
      lineNumber: selection.positionLineNumber,
      column: selection.positionColumn,
    }),
  }));

const restoreSelections = (
  target: MonacoEditor,
  model: MonacoModel,
  selections: OffsetSelection[],
) => {
  target.setSelections(
    selections.map(({ anchor, active }) => {
      const anchorPosition = model.getPositionAt(
        clampOffset(model, anchor),
      );
      const activePosition = model.getPositionAt(
        clampOffset(model, active),
      );
      return {
        selectionStartLineNumber: anchorPosition.lineNumber,
        selectionStartColumn: anchorPosition.column,
        positionLineNumber: activePosition.lineNumber,
        positionColumn: activePosition.column,
      };
    }),
    "weavo.remote",
  );
};

const transformSelections = (
  selections: OffsetSelection[],
  change: TextChange,
) =>
  selections.map(({ anchor, active }) => ({
    anchor: transformPosition(anchor, change),
    active: transformPosition(active, change),
  }));

const rangeFromOffsets = (
  model: MonacoModel,
  start: number,
  end: number,
) => {
  const startPosition = model.getPositionAt(clampOffset(model, start));
  const endPosition = model.getPositionAt(clampOffset(model, end));
  return {
    startLineNumber: startPosition.lineNumber,
    startColumn: startPosition.column,
    endLineNumber: endPosition.lineNumber,
    endColumn: endPosition.column,
  };
};

export const applyEditToModel = (
  target: MonacoEditor,
  model: MonacoModel,
  edit: TextEdit,
) => {
  const selections = captureSelections(target, model);
  const selectionChange: TextChange =
    edit.delete > 0
      ? { index: edit.index, delete: edit.delete }
      : { index: edit.index, insert: edit.insert };
  const afterDelete =
    edit.delete > 0
      ? transformSelections(selections, {
          index: edit.index,
          delete: edit.delete,
        })
      : selections;
  const transformed =
    edit.insert.length > 0
      ? transformSelections(afterDelete, {
          index: edit.index,
          insert: edit.insert,
        })
      : afterDelete;

  model.applyEdits([
    {
      range: rangeFromOffsets(
        model,
        edit.index,
        edit.index + edit.delete,
      ),
      text: edit.insert,
      forceMoveMarkers: true,
    },
  ]);

  restoreSelections(
    target,
    model,
    edit.delete > 0 && edit.insert.length === 0
      ? transformSelections(selections, selectionChange)
      : transformed,
  );
};

export const applyRemoteChange = (
  target: MonacoEditor,
  model: MonacoModel,
  change: TextChange,
) => {
  applyEditToModel(target, model, {
    index: change.index,
    delete: change.delete ?? 0,
    insert: change.insert ?? "",
  });
};

export const applyLocalChanges = (
  host: WeavoAdapterHost,
  changes: readonly editor.IModelContentChange[],
) => {
  const ordered = [...changes].sort(
    (left, right) => right.rangeOffset - left.rangeOffset,
  );

  for (const change of ordered) {
    if (change.rangeLength === 0 && change.text.length === 0) continue;
    const snapshot = {
      start: change.rangeOffset,
      end: change.rangeOffset + change.rangeLength,
      value: host.getText(),
    };

    if (change.text.length === 0) {
      host.applyLocal({ inputType: "deleteContentForward" }, snapshot);
    } else {
      host.applyLocal(
        { inputType: "insertText", data: change.text },
        snapshot,
      );
    }
  }
};
