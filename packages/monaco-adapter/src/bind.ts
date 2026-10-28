import {
  transformPosition,
  type WeavoAdapter,
  type WeavoAdapterHost,
} from "@weavo/client";
import type { editor } from "monaco-editor";
import {
  applyEditToModel,
  applyLocalChanges,
  applyRemoteChange,
} from "./model";
import { textEditFromDiff } from "./textEdit";
import type {
  CompositionState,
  MonacoEditor,
  MonacoModel,
} from "./types";

const selectionOffsets = (
  target: MonacoEditor,
  model: MonacoModel,
) => {
  const selection = target.getSelection();
  if (!selection) return { start: 0, end: 0 };
  const anchor = model.getOffsetAt({
    lineNumber: selection.selectionStartLineNumber,
    column: selection.selectionStartColumn,
  });
  const active = model.getOffsetAt({
    lineNumber: selection.positionLineNumber,
    column: selection.positionColumn,
  });
  return {
    start: Math.min(anchor, active),
    end: Math.max(anchor, active),
  };
};

const bindMonaco = (
  host: WeavoAdapterHost,
  target: editor.IStandaloneCodeEditor,
) => {
  const model = target.getModel();
  if (!model) {
    throw new Error("Cannot bind Weavo to a Monaco editor without a model");
  }

  let applyingRemote = false;
  let composition: CompositionState | null = null;
  const originalReadOnly = target.getRawOptions().readOnly ?? false;

  const setJoinedState = () => {
    target.updateOptions({ readOnly: originalReadOnly });
  };

  if (model.getValue() !== host.getText()) {
    model.setValue(host.getText());
  }

  if (!host.isJoined()) {
    target.updateOptions({ readOnly: true });
  } else {
    setJoinedState();
  }

  let unsubJoined: (() => void) | undefined;
  if (!host.isJoined()) {
    unsubJoined = host.onJoined(() => {
      setJoinedState();
      unsubJoined?.();
      unsubJoined = undefined;
    });
  }

  host.setCursorSource(() => {
    const position = target.getPosition();
    return position ? model.getOffsetAt(position) : 0;
  });

  const contentDisposable = model.onDidChangeContent((event) => {
    if (applyingRemote || composition) return;
    applyLocalChanges(host, event.changes);
  });

  const compositionStartDisposable = target.onDidCompositionStart(() => {
    if (!host.isJoined()) return;
    const selection = selectionOffsets(target, model);
    composition = {
      value: model.getValue(),
      start: selection.start,
      end: selection.end,
      docStart: selection.start,
      docEnd: selection.end,
    };
  });

  const compositionEndDisposable = target.onDidCompositionEnd(() => {
    const current = composition;
    composition = null;
    if (!current) return;

    const value = model.getValue();
    const tailLength = current.value.length - current.end;
    const composedEnd = Math.max(
      current.start,
      value.length - tailLength,
    );
    const composed = value.slice(current.start, composedEnd);

    if (composed.length > 0 || current.docEnd > current.docStart) {
      host.applyLocal(
        { inputType: "insertText", data: composed },
        {
          start: current.docStart,
          end: current.docEnd,
          value: host.getText(),
        },
      );
    }

    const edit = textEditFromDiff(model.getValue(), host.getText());
    if (edit) {
      applyingRemote = true;
      try {
        applyEditToModel(target, model, edit);
      } finally {
        applyingRemote = false;
      }
    }
  });

  const unsubRemote = host.onRemote(({ change, text }) => {
    if (composition) {
      composition.docStart = transformPosition(
        composition.docStart,
        change,
      );
      composition.docEnd = transformPosition(
        composition.docEnd,
        change,
      );
      return;
    }

    applyingRemote = true;
    try {
      applyRemoteChange(target, model, change);
      const correction = textEditFromDiff(model.getValue(), text);
      if (correction) applyEditToModel(target, model, correction);
    } finally {
      applyingRemote = false;
    }
  });

  return () => {
    unsubJoined?.();
    unsubRemote();
    contentDisposable.dispose();
    compositionStartDisposable.dispose();
    compositionEndDisposable.dispose();
    composition = null;
    host.setCursorSource(null);
    target.updateOptions({ readOnly: originalReadOnly });
  };
};

export const monacoAdapter: WeavoAdapter<MonacoEditor> = {
  bind: bindMonaco,
};
