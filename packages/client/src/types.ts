import type { ClientId, Operation } from "@weavo/core";

export type TimerRef = { current: ReturnType<typeof setTimeout> | undefined };

export type PeersReq = ClientId[];

export type TextChange = {
  index: number;
  insert?: string;
  delete?: number;
};

export type InputSnapshot = { start: number; end: number; value: string };

export type LocalInput = {
  inputType: string;
  data?: string | null;
};

export type RemoteChange = {
  op: Operation;
  index: number;
  change: TextChange;
  text: string;
};

export type WeavoAdapterHost = {
  getText: () => string;
  isJoined: () => boolean;
  onJoined: (listener: () => void) => () => void;
  applyLocal: (input: LocalInput, snapshot: InputSnapshot) => void;
  onRemote: (listener: (change: RemoteChange) => void) => () => void;
  setCursorSource: (getCursor: (() => number) | null) => void;
};

export type WeavoAdapter<TTarget> = {
  bind: (host: WeavoAdapterHost, target: TTarget) => () => void;
};

export type { OnApplied } from "@weavo/core";
