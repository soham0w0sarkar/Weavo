import type { ClientId } from "@repo/core";

export type TimerRef = { current: ReturnType<typeof setTimeout> | undefined };

export type PeersReq = ClientId[];
