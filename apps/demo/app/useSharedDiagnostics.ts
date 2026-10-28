"use client";

import { useEffect, useRef } from "react";
import type { Monaco } from "@monaco-editor/react";
import type { Uri, editor } from "monaco-editor";
import {
  openRoomBus,
  type RoomBus,
  type SharedMarker,
} from "./lib/roomBus";

const ownerSource = (clientId: string) => `weavo.diagnostics:${clientId}`;

const toShared = (markers: editor.IMarker[]): SharedMarker[] =>
  markers
    .filter((marker) => marker.severity >= 4) // Warning + Error
    .slice(0, 100)
    .map((marker) => ({
      severity: marker.severity,
      message: marker.message,
      startLineNumber: marker.startLineNumber,
      startColumn: marker.startColumn,
      endLineNumber: marker.endLineNumber,
      endColumn: marker.endColumn,
      ...(marker.code
        ? {
            code:
              typeof marker.code === "string"
                ? marker.code
                : String(marker.code.value),
          }
        : {}),
    }));

const fromShared = (
  markers: SharedMarker[],
  ownerName: string,
): editor.IMarkerData[] =>
  markers.map((marker) => ({
    severity: marker.severity,
    message: `${marker.message} · ${ownerName}`,
    startLineNumber: marker.startLineNumber,
    startColumn: marker.startColumn,
    endLineNumber: marker.endLineNumber,
    endColumn: marker.endColumn,
    ...(marker.code ? { code: marker.code } : {}),
  }));

/**
 * Publish local Monaco markers to the room and paint peers' markers inline.
 * Uses a second WebSocket on the same room URL (relay forwards opaque frames).
 */
export const useSharedDiagnostics = ({
  monaco,
  editorInstance,
  weavoUrl,
  joined,
  selfId,
  displayName,
  displayColor,
  language,
}: {
  monaco: Monaco | null;
  editorInstance: editor.IStandaloneCodeEditor | null;
  weavoUrl: string;
  joined: boolean;
  selfId: string;
  displayName: string;
  displayColor: string;
  language: string;
}) => {
  const busRef = useRef<RoomBus | null>(null);
  const latestRef = useRef({
    selfId,
    displayName,
    displayColor,
    language,
  });
  latestRef.current = { selfId, displayName, displayColor, language };

  useEffect(() => {
    if (!joined || !weavoUrl || !selfId) return;

    const bus = openRoomBus(weavoUrl, (message) => {
      if (message.kind !== "diagnostics") return;
      if (message.clientId === latestRef.current.selfId) return;
      if (!monaco || !editorInstance) return;
      const model = editorInstance.getModel();
      if (!model) return;

      monaco.editor.setModelMarkers(
        model,
        ownerSource(message.clientId),
        fromShared(message.markers, message.name),
      );
    });
    busRef.current = bus;

    return () => {
      bus.close();
      busRef.current = null;
    };
  }, [joined, weavoUrl, selfId, monaco, editorInstance]);

  useEffect(() => {
    if (!monaco || !editorInstance || !joined || !selfId) return;
    const model = editorInstance.getModel();
    if (!model) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const publish = () => {
      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((marker: editor.IMarker) => {
          // Only publish markers from local language services, not peers'.
          return !marker.owner.startsWith("weavo.diagnostics:");
        });

      busRef.current?.send({
        v: 1,
        kind: "diagnostics",
        clientId: latestRef.current.selfId,
        name: latestRef.current.displayName,
        color: latestRef.current.displayColor,
        language: latestRef.current.language,
        markers: toShared(markers),
      });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(publish, 280);
    };

    schedule();
    const sub = monaco.editor.onDidChangeMarkers((uris: readonly Uri[]) => {
      if (uris.some((uri: Uri) => uri.toString() === model.uri.toString())) {
        schedule();
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      sub.dispose();
      monaco.editor.setModelMarkers(model, ownerSource(selfId), []);
    };
  }, [monaco, editorInstance, joined, selfId, language]);
};
