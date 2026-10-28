"use client";

import { useCallback, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { monacoAdapter } from "@weavo/monaco-adapter";
import { MonacoRemoteCursors } from "./MonacoRemoteCursors";
import { useWeavoEditor } from "./useWeavoEditor";

const getMonacoText = (target: editor.IStandaloneCodeEditor) =>
  target.getValue();

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
  const handleMount = useCallback<OnMount>((instance, monacoApi) => {
    setEditorInstance(instance);
    setMonaco(monacoApi);
  }, []);
  const { joined, peers, selfId, text } = useWeavoEditor({
    target: editorInstance,
    adapter: monacoAdapter,
    getTargetText: getMonacoText,
    weavoUrl,
    skipRestoreOnce,
    displayName,
    displayColor,
  });

  return (
    <div className="editor-shell">
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
      ) : null}
      <div className="editor-canvas monaco-canvas">
        <Editor
          defaultLanguage="plaintext"
          defaultValue=""
          height="100%"
          onMount={handleMount}
          loading={<span className="monaco-loading">Loading Monaco…</span>}
          options={{
            automaticLayout: true,
            fontSize: 15,
            lineHeight: 24,
            minimap: { enabled: false },
            padding: { top: 18, bottom: 18 },
            scrollBeyondLastLine: false,
            wordWrap: "on",
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
