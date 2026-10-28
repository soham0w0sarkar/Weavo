"use client";

import { useCallback, useEffect, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { monacoAdapter } from "@weavo/monaco-adapter";
import { MonacoRemoteCursors } from "./MonacoRemoteCursors";
import { useWeavoEditor } from "./useWeavoEditor";
import { useSharedDiagnostics } from "./useSharedDiagnostics";
import {
  configureLanguageServices,
  DEFAULT_DEMO_LANGUAGE,
  DEMO_LANGUAGES,
  hasLanguageService,
  type DemoLanguage,
} from "./monacoLanguages";

const getMonacoText = (target: editor.IStandaloneCodeEditor) =>
  target.getValue();

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const editorTheme = (dark: boolean) => (dark ? "vs-dark" : "light");

export function WeavoMonaco({
  weavoUrl,
  skipRestoreOnce = false,
  displayName,
  displayColor,
}: {
  weavoUrl: string;
  skipRestoreOnce?: boolean;
  displayName: string;
  displayColor: string;
}) {
  const [editorInstance, setEditorInstance] =
    useState<editor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [language, setLanguage] = useState<DemoLanguage>(DEFAULT_DEMO_LANGUAGE);
  const [theme, setTheme] = useState<"vs-dark" | "light">(() =>
    editorTheme(prefersDark()),
  );

  const handleMount = useCallback<OnMount>((instance, monacoApi) => {
    configureLanguageServices(monacoApi);
    const next = editorTheme(prefersDark());
    monacoApi.editor.setTheme(next);
    setTheme(next);
    setEditorInstance(instance);
    setMonaco(monacoApi);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const next = editorTheme(media.matches);
      setTheme(next);
      monaco?.editor.setTheme(next);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [monaco]);

  useEffect(() => {
    if (!monaco || !editorInstance) return;
    const model = editorInstance.getModel();
    if (!model) return;
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [monaco, editorInstance, language]);

  const { joined, peers, selfId, text } = useWeavoEditor({
    target: editorInstance,
    adapter: monacoAdapter,
    getTargetText: getMonacoText,
    weavoUrl,
    skipRestoreOnce,
    displayName,
    displayColor,
  });

  useSharedDiagnostics({
    monaco,
    editorInstance,
    weavoUrl,
    joined,
    selfId,
    displayName,
    displayColor,
    language,
  });

  return (
    <div className="editor-shell">
      <div className="monaco-toolbar">
        {peers.length > 0 ? (
          <div className="presence-bar" aria-label="People in this room">
            {peers.map((peer) => (
              <span
                key={peer.clientId}
                className={
                  peer.clientId === selfId
                    ? "presence-chip presence-chip-self"
                    : "presence-chip"
                }
              >
                <span
                  className="presence-dot"
                  style={{ background: peer.color }}
                  aria-hidden
                />
                {peer.name}
                {peer.clientId === selfId ? " (you)" : ""}
              </span>
            ))}
          </div>
        ) : (
          <span className="monaco-toolbar-spacer" />
        )}

        <label className="monaco-language">
          <span className="monaco-language-label">Language</span>
          <select
            className="monaco-language-select"
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as DemoLanguage)
            }
            aria-label="Editor language"
          >
            {DEMO_LANGUAGES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
                {hasLanguageService(entry.id) ? " · IntelliSense" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="editor-canvas monaco-canvas">
        <Editor
          theme={theme}
          defaultLanguage={DEFAULT_DEMO_LANGUAGE}
          defaultValue=""
          height="100%"
          onMount={handleMount}
          loading={<span className="monaco-loading">Loading Monaco…</span>}
          options={{
            automaticLayout: true,
            fontFamily:
              "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 14,
            fontLigatures: false,
            lineHeight: 22,
            letterSpacing: 0,
            minimap: { enabled: false },
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            glyphMargin: true,
            folding: true,
            lineDecorationsWidth: 8,
            renderLineHighlight: "line",
            renderValidationDecorations: "on",
            overviewRulerLanes: 2,
            hideCursorInOverviewRuler: false,
            overviewRulerBorder: false,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
            contextmenu: true,
            links: true,
            quickSuggestions: {
              other: true,
              comments: false,
              strings: false,
            },
            suggestOnTriggerCharacters: true,
            wordBasedSuggestions: hasLanguageService(language)
              ? "off"
              : "currentDocument",
            parameterHints: { enabled: true },
            hover: { enabled: "on" },
            tabCompletion: "on",
            formatOnPaste: true,
            formatOnType: true,
            find: {
              addExtraSpaceOnTop: false,
              autoFindInSelection: "never",
              seedSearchStringFromSelection: "selection",
            },
            occurrencesHighlight: "singleFile",
            selectionHighlight: true,
            matchBrackets: "near",
            bracketPairColorization: { enabled: true },
            roundedSelection: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            smoothScrolling: true,
          }}
        />
        <MonacoRemoteCursors
          editorInstance={editorInstance}
          monaco={monaco}
          peers={peers.filter((peer) => peer.clientId !== selfId)}
          text={text}
        />
        {!joined ? (
          <div className="editor-joining" role="status" aria-live="polite">
            <span className="editor-joining-spinner" aria-hidden />
            Joining room…
          </div>
        ) : null}
      </div>
    </div>
  );
}
