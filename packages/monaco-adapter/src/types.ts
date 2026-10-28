import type { editor } from "monaco-editor";

export type CompositionState = {
  value: string;
  start: number;
  end: number;
  docStart: number;
  docEnd: number;
};

export type TextEdit = {
  index: number;
  delete: number;
  insert: string;
};

export type MonacoEditor = editor.IStandaloneCodeEditor;
export type MonacoModel = editor.ITextModel;
