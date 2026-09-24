import {
  createGCTracker,
  createReplica,
  generateClientId,
  getText,
  onInput as localInput,
  restoreFromStorage,
  runGC,
  takeSnapshot,
  type ClientId,
  type DocumentSnapshot,
  type GCFrontier,
  type Operation,
} from "@weavo/core";
import {
  createMembership,
  getClientId,
  type MembershipHandle,
} from "@weavo/membership";
import { createBuffer, update, type StateVector } from "@weavo/sync";
import {
  createTransport,
  createWebSocketTransport,
  type RawTransport,
} from "@weavo/transport";
import { createSubscription } from "./Subscription";
import { toTextChange } from "./textChange";
import { manageTransport } from "./transport";
import type {
  InputSnapshot,
  LocalInput,
  RemoteChange,
  WeavoAdapter,
  WeavoAdapterHost,
} from "./types";

export type WeavoOptions<TTarget = never> = {
  adapter?: WeavoAdapter<TTarget>;
  clientId?: ClientId;
  onOp?: (op: Operation) => void;
  foundingGraceMs?: number;
  initialMembers?: ClientId[];
  initialVersion?: number;
  name?: string;
  color?: string;
  heartbeatIntervalMs?: number;
  presenceTimeoutMs?: number;
  removalTimeoutMs?: number;
  gcGracePeriodMs?: number;
  initial?: {
    snapshot: DocumentSnapshot;
    delta?: Operation[];
  };
};

const colorFromId = (clientId: ClientId): string => {
  let hash = 0;
  for (let index = 0; index < clientId.length; index++) {
    hash = (hash * 31 + clientId.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 70% 45%)`;
};

export const createWeavo = <TTarget = never>(
  urlOrTransport: string | RawTransport,
  options: WeavoOptions<TTarget> = {},
) => {
  const restored = options.initial
    ? restoreFromStorage(options.initial.snapshot, options.initial.delta ?? [])
    : null;

  const clientId = options.clientId ?? generateClientId();
  const doc = restored?.doc ?? createReplica(clientId);
  const sv: StateVector = restored?.stateVector ?? new Map();
  const buffer = createBuffer();
  const rawTransport =
    typeof urlOrTransport === "string"
      ? createWebSocketTransport(urlOrTransport)
      : urlOrTransport;

  const displayName = options.name ?? clientId.slice(0, 8);
  const displayColor = options.color ?? colorFromId(clientId);
  let presenceName = displayName;
  let presenceColor = displayColor;
  let getLocalCursor: (() => number) | null = null;

  let membership!: MembershipHandle;
  const transport = createTransport(rawTransport, {
    idCodec: {
      encodeVersion: () => membership.getCurrent()?.version ?? 0,
      shortIdOf: (id) => membership.shortIdOf(id),
      clientIdOf: (version, shortId) => {
        const table = membership.getVersion(version);
        return table ? getClientId(table, shortId) : null;
      },
      hasVersion: (version) => membership.getVersion(version) !== null,
      onMissingVersion: (version) => membership.requestMembership(version),
    },
  });
  membership = createMembership((message) => transport.send(message), {
    clientId,
    getPresence: () => ({
      cursor: getLocalCursor?.() ?? 0,
      name: presenceName,
      color: presenceColor,
    }),
    getStateVector: () => Object.fromEntries(sv),
    ...(options.foundingGraceMs !== undefined
      ? { foundingGraceMs: options.foundingGraceMs }
      : {}),
    ...(options.initialMembers !== undefined
      ? { initialMembers: options.initialMembers }
      : {}),
    ...(options.initialVersion !== undefined
      ? { initialVersion: options.initialVersion }
      : {}),
    ...(options.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
      : {}),
    ...(options.presenceTimeoutMs !== undefined
      ? { presenceTimeoutMs: options.presenceTimeoutMs }
      : {}),
    ...(options.removalTimeoutMs !== undefined
      ? { removalTimeoutMs: options.removalTimeoutMs }
      : {}),
  });
  const subscription = createSubscription();
  const remoteListeners = new Set<(change: RemoteChange) => void>();
  const gcTracker = createGCTracker();
  const gcGracePeriodMs =
    options.gcGracePeriodMs ?? options.removalTimeoutMs ?? 30_000;

  let lastFrontier: GCFrontier = new Map();

  const frontierMoved = (next: GCFrontier) => {
    if (next.size !== lastFrontier.size) return true;
    for (const [id, clock] of next) {
      if (lastFrontier.get(id) !== clock) return true;
    }
    return false;
  };

  const sweepGC = () => {
    const frontier = membership.computeGCFrontier();
    if (!frontierMoved(frontier) && gcTracker.candidates.size === 0) return;
    lastFrontier = frontier;
    runGC(doc.store, frontier, gcTracker, {
      gracePeriodMs: gcGracePeriodMs,
    });
  };

  membership.onPresence(() => {
    sweepGC();
  });

  const emitChange = (change: ReturnType<typeof toTextChange>) =>
    subscription.emit(change);

  const notifyOp = (op: Operation) => options.onOp?.(op);

  const noteAuthorCursor = (op: Operation, index: number) => {
    if (op.type !== "insert") return;
    const author = op.id[0];
    if (author === clientId) return;
    membership.setCursor(author, index + 1);
  };

  const onApplied = (op: Operation, index: number) => {
    notifyOp(op);
    const change = toTextChange(op, index);
    emitChange(change);
    noteAuthorCursor(op, index);
    const text = getText(doc.store);
    for (const listener of remoteListeners) {
      listener({ op, index, change, text });
    }
  };

  const applyLocal = (input: LocalInput, snapshot: InputSnapshot) => {
    if (!membership.isJoined()) return;

    const applied = localInput(
      { inputType: input.inputType, data: input.data ?? null } as InputEvent,
      doc,
      snapshot,
    );
    if (!applied) return;
    applied.forEach(({ op, index }) => {
      if (op.type === "insert") {
        update(sv, op.id);
      }
      notifyOp(op);
      emitChange(toTextChange(op, index));
      transport.send({ type: "op", op });
    });
  };

  manageTransport(transport, doc, sv, buffer, onApplied, membership);
  transport.connect();

  const host: WeavoAdapterHost = {
    getText: () => getText(doc.store),
    isJoined: () => membership.isJoined(),
    onJoined: (listener) => membership.onJoined(() => listener()),
    applyLocal,
    onRemote: (listener) => {
      remoteListeners.add(listener);
      return () => {
        remoteListeners.delete(listener);
      };
    },
    setCursorSource: (getCursor) => {
      getLocalCursor = getCursor;
    },
  };

  return {
    bind: (target: TTarget) => {
      if (!options.adapter) {
        throw new Error(
          "createWeavo requires an adapter before bind() can be used",
        );
      }
      return options.adapter.bind(host, target);
    },
    textSubscribe: subscription.subscribe,
    onPresence: membership.onPresence,
    getPresence: () => membership.getPresence(),
    setIdentity: (identity: { name?: string; color?: string }) => {
      if (identity.name !== undefined) presenceName = identity.name;
      if (identity.color !== undefined) presenceColor = identity.color;
    },
    snapshot: (): DocumentSnapshot => takeSnapshot(doc, sv),
    disconnect: () => {
      membership.leave();
      transport.disconnect();
    },
    membership,
  };
};

export type Weavo<TTarget = never> = ReturnType<typeof createWeavo<TTarget>>;
