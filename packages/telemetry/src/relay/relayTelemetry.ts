import { histogramSamples, type MetricFamily } from "../exporters/families";

/**
 * Relay metrics. Every series is global: no room id, origin, or socket id is
 * ever a label. A hostile client that opens a million rooms changes a
 * histogram bucket count, not the number of series.
 */

export type RejectReason = "origin" | "method";

export type RelaySource = {
  /** Peer count of each room that currently exists. Read on each scrape. */
  roomSizes: () => Iterable<number>;
};

export type RelayTelemetry = {
  connectionOpened: () => void;
  connectionClosed: () => void;
  /** A frame arrived from a client. `bytes` is its size on the wire. */
  messageReceived: (bytes: number) => void;
  /** A frame was sent to `recipients` peers. `bytes` is one copy's size. */
  fanOut: (recipients: number, bytes: number) => void;
  /** A frame was sent while a peer's send buffer was over the warning limit. */
  backpressured: () => void;
  upgradeRejected: (reason: RejectReason) => void;
  families: () => MetricFamily[];
};

type Histogram = {
  bounds: readonly number[];
  counts: number[];
  sum: number;
  count: number;
};

const PEER_BOUNDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] as const;

const newHistogram = (bounds: readonly number[]): Histogram => ({
  bounds,
  counts: new Array<number>(bounds.length + 1).fill(0),
  sum: 0,
  count: 0,
});

const observe = (histogram: Histogram, value: number) => {
  let slot = 0;
  while (slot < histogram.bounds.length && value > histogram.bounds[slot]!) {
    slot++;
  }
  histogram.counts[slot]!++;
  histogram.sum += value;
  histogram.count++;
};

const scalar = (
  name: string,
  type: "counter" | "gauge",
  help: string,
  value: number,
): MetricFamily => ({
  name,
  type,
  help,
  samples: [{ name, labels: {}, value }],
});

const histogramFamily = (
  name: string,
  help: string,
  histogram: Histogram,
): MetricFamily => ({
  name,
  type: "histogram",
  help,
  samples: histogramSamples(
    name,
    histogram.bounds,
    histogram.counts,
    histogram.sum,
    histogram.count,
  ),
});

export const createRelayTelemetry = (source: RelaySource): RelayTelemetry => {
  let connectionsActive = 0;
  let connectionsTotal = 0;
  let messagesIn = 0;
  let bytesIn = 0;
  let messagesOut = 0;
  let bytesOut = 0;
  let backpressured = 0;
  const rejected: Record<RejectReason, number> = { origin: 0, method: 0 };
  const fanout = newHistogram(PEER_BOUNDS);

  return {
    connectionOpened() {
      connectionsActive++;
      connectionsTotal++;
    },
    connectionClosed() {
      connectionsActive = Math.max(0, connectionsActive - 1);
    },
    messageReceived(bytes) {
      messagesIn++;
      bytesIn += bytes;
    },
    fanOut(recipients, bytes) {
      if (recipients < 1) return;
      messagesOut += recipients;
      bytesOut += bytes * recipients;
      observe(fanout, recipients);
    },
    backpressured() {
      backpressured++;
    },
    upgradeRejected(reason) {
      rejected[reason]++;
    },
    families() {
      const rooms = newHistogram(PEER_BOUNDS);
      let roomCount = 0;
      for (const size of source.roomSizes()) {
        observe(rooms, size);
        roomCount++;
      }

      const rejectedFamily: MetricFamily = {
        name: "weavo_relay_rejected_upgrades_total",
        type: "counter",
        help: "Websocket upgrades refused, by reason",
        samples: (["origin", "method"] as const).map((reason) => ({
          name: "weavo_relay_rejected_upgrades_total",
          labels: { reason },
          value: rejected[reason],
        })),
      };

      return [
        scalar(
          "weavo_relay_connections_active",
          "gauge",
          "Open websocket connections",
          connectionsActive,
        ),
        scalar(
          "weavo_relay_connections_total",
          "counter",
          "Websocket connections opened since start",
          connectionsTotal,
        ),
        scalar(
          "weavo_relay_rooms_active",
          "gauge",
          "Rooms with at least one connected peer",
          roomCount,
        ),
        histogramFamily(
          "weavo_relay_room_peers",
          "Peers per room, read on each scrape",
          rooms,
        ),
        scalar(
          "weavo_relay_messages_in_total",
          "counter",
          "Frames received from clients",
          messagesIn,
        ),
        scalar(
          "weavo_relay_bytes_in_total",
          "counter",
          "Bytes received from clients",
          bytesIn,
        ),
        scalar(
          "weavo_relay_messages_fanned_out_total",
          "counter",
          "Frames sent to peers, one per recipient",
          messagesOut,
        ),
        scalar(
          "weavo_relay_bytes_out_total",
          "counter",
          "Bytes sent to peers, one per recipient",
          bytesOut,
        ),
        histogramFamily(
          "weavo_relay_fanout_recipients",
          "Recipients per broadcast",
          fanout,
        ),
        scalar(
          "weavo_relay_backpressured_frames_total",
          "counter",
          "Frames sent while a peer's send buffer was over the warning limit",
          backpressured,
        ),
        rejectedFamily,
      ];
    },
  };
};
