"use client";

import { useEffect } from "react";
import type { Monaco } from "@monaco-editor/react";
import type { PeerPresence } from "@weavo/client";
import type { editor } from "monaco-editor";
import { readableTextColor } from "./lib/clientStorage";

export function MonacoRemoteCursors({
  editorInstance,
  monaco,
  peers,
  text,
}: {
  editorInstance: editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  peers: PeerPresence[];
  text: string;
}) {
  useEffect(() => {
    if (!editorInstance || !monaco) return;
    const model = editorInstance.getModel();
    if (!model) return;

    const widgets = peers.map((peer) => {
      const node = document.createElement("span");
      node.className = "monaco-remote-caret";
      node.style.borderColor = peer.color;

      const label = document.createElement("span");
      label.className = "monaco-remote-caret-label";
      label.style.background = peer.color;
      label.style.color = readableTextColor(peer.color);
      label.textContent = peer.name;
      node.append(label);

      const position = model.getPositionAt(
        Math.max(0, Math.min(peer.cursor, text.length)),
      );
      const widget: editor.IContentWidget = {
        getId: () => `weavo-peer-${peer.clientId}`,
        getDomNode: () => node,
        getPosition: () => ({
          position,
          preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
        }),
      };

      editorInstance.addContentWidget(widget);
      return widget;
    });

    return () => {
      for (const widget of widgets) {
        editorInstance.removeContentWidget(widget);
      }
    };
  }, [editorInstance, monaco, peers, text]);

  return null;
}
