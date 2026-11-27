import type { WeavoTelemetryHook } from "@weavo/client";
import {
  createClientTelemetry,
  roomLabel,
  startConsoleExporter,
  startOtlpPush,
} from "@weavo/telemetry";
import {
  createWebSocketTransport,
  MSG_MEMBERSHIP,
  type RawTransport,
} from "@weavo/transport";

const PRINT_EVERY_MS = 3_000;
/** Local OpenTelemetry Collector from infra/telemetry. */
const OTLP_URL = "http://localhost:4318/v1/metrics";
const PUSH_EVERY_MS = 5_000;

/**
 * Each incoming op or sync frame waits a random 0..maxMs, so later frames can
 * overtake earlier ones. That is how ops arrive out of order on purpose.
 * Membership frames pass straight through: delaying them stalls the join
 * past the founding grace and splits the room in two.
 */
const delayIncoming = (raw: RawTransport, maxMs: number): RawTransport => ({
  ...raw,
  onMessage: (cb) =>
    raw.onMessage((data) => {
      if (data[1] === MSG_MEMBERSHIP) {
        cb(data);
        return;
      }
      setTimeout(() => cb(data), Math.random() * maxMs);
    }),
});

export type DebugSession = {
  /** Pass to createWeavo in place of the url. */
  connection: string | RawTransport;
  telemetry?: WeavoTelemetryHook;
  stop: () => void;
};

/**
 * Debug switches read from the page url:
 *   ?telemetry       collect metrics and print them to the console every 3 s
 *   ?telemetry=otel  collect metrics and push them to the local collector,
 *                    tagged with a hashed room label (logged on start)
 *   ?delay=400   hold each incoming op frame for a random 0..400 ms
 * With neither, this is a pass-through.
 */
export const createDebugSession = (weavoUrl: string): DebugSession => {
  const params = new URLSearchParams(window.location.search);
  const delayMs = Number(params.get("delay") ?? 0);
  const connection =
    delayMs > 0
      ? delayIncoming(createWebSocketTransport(weavoUrl), delayMs)
      : weavoUrl;

  const mode = params.get("telemetry");
  if (mode === null) return { connection, stop: () => {} };

  const collector = createClientTelemetry();
  Object.assign(window, { __weavoTelemetry: collector });
  const room = new URL(weavoUrl).searchParams.get("room") || undefined;
  if (room !== undefined) {
    console.info(`[weavo telemetry] room label ${roomLabel(room)}`);
  }
  const stop =
    mode === "otel"
      ? startOtlpPush(collector, {
          url: OTLP_URL,
          intervalMs: PUSH_EVERY_MS,
          ...(room === undefined ? {} : { room }),
        })
      : startConsoleExporter(collector, {
          intervalMs: PRINT_EVERY_MS,
          log: (text) => console.log(`[weavo telemetry]\n${text}`),
        });
  return { connection, telemetry: collector.hook, stop };
};
