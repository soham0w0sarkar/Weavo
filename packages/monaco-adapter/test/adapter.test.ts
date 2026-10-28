import { describe, expect, test } from "bun:test";
import type {
  RemoteChange,
  WeavoAdapterHost,
} from "@weavo/client";
import type {
  editor,
  IDisposable,
  IPosition,
  ISelection,
} from "monaco-editor";
import { monacoAdapter } from "../src";

type Change = {
  rangeOffset: number;
  rangeLength: number;
  text: string;
};

const disposable = (dispose: () => void): IDisposable => ({ dispose });

class FakeModel {
  value: string;
  listeners = new Set<(event: editor.IModelContentChangedEvent) => void>();

  constructor(value: string) {
    this.value = value;
  }

  getValue() {
    return this.value;
  }

  getValueLength() {
    return this.value.length;
  }

  getPositionAt(offset: number): IPosition {
    const head = this.value.slice(0, offset);
    const lines = head.split("\n");
    return {
      lineNumber: lines.length,
      column: lines[lines.length - 1]!.length + 1,
    };
  }

  getOffsetAt(position: IPosition) {
    const lines = this.value.split("\n");
    let offset = 0;
    for (let line = 1; line < position.lineNumber; line++) {
      offset += lines[line - 1]!.length + 1;
    }
    return offset + position.column - 1;
  }

  setValue(value: string) {
    const oldLength = this.value.length;
    this.value = value;
    this.emit([{ rangeOffset: 0, rangeLength: oldLength, text: value }]);
  }

  applyEdits(edits: editor.IIdentifiedSingleEditOperation[]) {
    const changes = edits
      .map((edit) => {
        const start = this.getOffsetAt({
          lineNumber: edit.range.startLineNumber,
          column: edit.range.startColumn,
        });
        const end = this.getOffsetAt({
          lineNumber: edit.range.endLineNumber,
          column: edit.range.endColumn,
        });
        return {
          rangeOffset: start,
          rangeLength: end - start,
          text: edit.text ?? "",
        };
      })
      .sort((left, right) => right.rangeOffset - left.rangeOffset);

    this.applyChanges(changes);
    return [];
  }

  onDidChangeContent(
    listener: (event: editor.IModelContentChangedEvent) => void,
  ) {
    this.listeners.add(listener);
    return disposable(() => this.listeners.delete(listener));
  }

  userChanges(changes: Change[]) {
    this.applyChanges(
      [...changes].sort(
        (left, right) => right.rangeOffset - left.rangeOffset,
      ),
    );
  }

  private applyChanges(changes: Change[]) {
    for (const change of changes) {
      this.value =
        this.value.slice(0, change.rangeOffset) +
        change.text +
        this.value.slice(change.rangeOffset + change.rangeLength);
    }
    this.emit(changes);
  }

  private emit(changes: Change[]) {
    const event = { changes } as editor.IModelContentChangedEvent;
    for (const listener of this.listeners) listener(event);
  }
}

class FakeEditor {
  readOnly = false;
  selection: ISelection = {
    selectionStartLineNumber: 1,
    selectionStartColumn: 1,
    positionLineNumber: 1,
    positionColumn: 1,
  };
  compositionStart = new Set<() => void>();
  compositionEnd = new Set<() => void>();

  constructor(readonly model: FakeModel) {}

  getModel() {
    return this.model;
  }

  getRawOptions() {
    return { readOnly: this.readOnly };
  }

  updateOptions(options: editor.IEditorOptions) {
    if (options.readOnly !== undefined) this.readOnly = options.readOnly;
  }

  getPosition() {
    return {
      lineNumber: this.selection.positionLineNumber,
      column: this.selection.positionColumn,
    };
  }

  getSelection() {
    return this.selection;
  }

  getSelections() {
    return [this.selection];
  }

  setSelections(selections: readonly ISelection[]) {
    this.selection = selections[0]!;
  }

  onDidCompositionStart(listener: () => void) {
    this.compositionStart.add(listener);
    return disposable(() => this.compositionStart.delete(listener));
  }

  onDidCompositionEnd(listener: () => void) {
    this.compositionEnd.add(listener);
    return disposable(() => this.compositionEnd.delete(listener));
  }

  startComposition() {
    for (const listener of this.compositionStart) listener();
  }

  endComposition() {
    for (const listener of this.compositionEnd) listener();
  }

  setCursor(offset: number) {
    const position = this.model.getPositionAt(offset);
    this.selection = {
      selectionStartLineNumber: position.lineNumber,
      selectionStartColumn: position.column,
      positionLineNumber: position.lineNumber,
      positionColumn: position.column,
    };
  }
}

const createHost = (initial: string, joined = true) => {
  let text = initial;
  let remoteListener: ((change: RemoteChange) => void) | undefined;
  let joinedListener: (() => void) | undefined;
  let cursorSource: (() => number) | null = null;
  const local: Array<{
    inputType: string;
    start: number;
    end: number;
    data: string | null | undefined;
  }> = [];

  const host: WeavoAdapterHost = {
    getText: () => text,
    isJoined: () => joined,
    onJoined: (listener) => {
      joinedListener = listener;
      return () => {
        joinedListener = undefined;
      };
    },
    applyLocal: (input, snapshot) => {
      local.push({
        inputType: input.inputType,
        start: snapshot.start,
        end: snapshot.end,
        data: input.data,
      });
      text =
        snapshot.value.slice(0, snapshot.start) +
        (input.data ?? "") +
        snapshot.value.slice(snapshot.end);
    },
    onRemote: (listener) => {
      remoteListener = listener;
      return () => {
        remoteListener = undefined;
      };
    },
    setCursorSource: (source) => {
      cursorSource = source;
    },
  };

  return {
    host,
    local,
    text: () => text,
    cursor: () => cursorSource?.() ?? null,
    join: () => {
      joined = true;
      joinedListener?.();
    },
    remote: (change: RemoteChange) => {
      text = change.text;
      remoteListener?.(change);
    },
    hasCursorSource: () => cursorSource !== null,
  };
};

const bind = (initial = "", joined = true) => {
  const model = new FakeModel(initial);
  const target = new FakeEditor(model);
  const state = createHost(initial, joined);
  const unbind = monacoAdapter.bind(
    state.host,
    target as unknown as editor.IStandaloneCodeEditor,
  );
  return { model, target, state, unbind };
};

describe("monacoAdapter", () => {
  test("maps local inserts, deletes, replacements, and multi-edits", () => {
    const { model, state } = bind("abcd");

    model.userChanges([{ rangeOffset: 1, rangeLength: 0, text: "X" }]);
    model.userChanges([{ rangeOffset: 2, rangeLength: 1, text: "" }]);
    model.userChanges([{ rangeOffset: 1, rangeLength: 1, text: "YZ" }]);
    model.userChanges([
      { rangeOffset: 0, rangeLength: 0, text: "L" },
      { rangeOffset: 3, rangeLength: 0, text: "R" },
    ]);

    expect(model.getValue()).toBe(state.text());
    expect(state.local.map(({ start }) => start)).toEqual([
      1, 2, 1, 3, 0,
    ]);
  });

  test("applies remote edits without echo and transforms the cursor", () => {
    const { model, target, state } = bind("abcd");
    target.setCursor(3);

    state.remote({
      op: {} as RemoteChange["op"],
      index: 1,
      change: { index: 1, insert: "XY" },
      text: "aXYbcd",
    });

    expect(model.getValue()).toBe("aXYbcd");
    expect(state.local).toHaveLength(0);
    expect(state.cursor()).toBe(5);
  });

  test("stays read-only until join and restores options on cleanup", () => {
    const { target, state, unbind } = bind("", false);

    expect(target.readOnly).toBe(true);
    state.join();
    expect(target.readOnly).toBe(false);
    expect(state.hasCursorSource()).toBe(true);

    unbind();
    expect(state.hasCursorSource()).toBe(false);
    expect(target.readOnly).toBe(false);
  });

  test("commits composition once after a concurrent remote insert", () => {
    const { model, target, state } = bind("ab");
    target.setCursor(1);
    target.startComposition();
    model.userChanges([{ rangeOffset: 1, rangeLength: 0, text: "あ" }]);

    state.remote({
      op: {} as RemoteChange["op"],
      index: 0,
      change: { index: 0, insert: "X" },
      text: "Xab",
    });
    expect(model.getValue()).toBe("aあb");
    expect(state.local).toHaveLength(0);

    target.endComposition();

    expect(state.local).toHaveLength(1);
    expect(state.local[0]).toMatchObject({
      inputType: "insertText",
      start: 2,
      end: 2,
      data: "あ",
    });
    expect(model.getValue()).toBe("Xaあb");
    expect(state.text()).toBe("Xaあb");
  });

  test("disposes listeners", () => {
    const { model, state, unbind } = bind("");
    unbind();
    model.userChanges([{ rangeOffset: 0, rangeLength: 0, text: "x" }]);
    expect(state.local).toHaveLength(0);
  });
});
