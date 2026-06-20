import type { ClientId } from "@repo/core";

export type TimerRef = { current: ReturnType<typeof setTimeout> | undefined };

export type PeersReq = ClientId[];

export type TextChange = {
  index: number;
  insert?: string;
  delete?: number;
};

export type { OnApplied } from "@repo/core";
