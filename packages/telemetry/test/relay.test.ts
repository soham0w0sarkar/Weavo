import { describe, expect, test } from "bun:test";
import { createRelayTelemetry } from "../src/relay/relayTelemetry";
import { formatPrometheus } from "../src/exporters/prometheus";

const make = (sizes: number[] = []) =>
  createRelayTelemetry({ roomSizes: () => sizes });

const valueOf = (text: string, series: string) => {
  const line = text.split("\n").find((l) => l.startsWith(`${series} `));
  if (!line) throw new Error(`missing ${series}`);
  return Number(line.slice(series.length + 1));
};

describe("relay telemetry", () => {
  test("connections: active goes up and down, total only goes up", () => {
    const relay = make();
    relay.connectionOpened();
    relay.connectionOpened();
    relay.connectionClosed();
    const text = formatPrometheus(relay.families());

    expect(valueOf(text, "weavo_relay_connections_active")).toBe(1);
    expect(valueOf(text, "weavo_relay_connections_total")).toBe(2);
  });

  test("active never goes below zero", () => {
    const relay = make();
    relay.connectionClosed();

    expect(
      valueOf(
        formatPrometheus(relay.families()),
        "weavo_relay_connections_active",
      ),
    ).toBe(0);
  });

  test("traffic counts frames and bytes, and fan-out multiplies bytes by recipients", () => {
    const relay = make();
    relay.messageReceived(10);
    relay.messageReceived(5);
    relay.fanOut(3, 10);
    const text = formatPrometheus(relay.families());

    expect(valueOf(text, "weavo_relay_messages_in_total")).toBe(2);
    expect(valueOf(text, "weavo_relay_bytes_in_total")).toBe(15);
    expect(valueOf(text, "weavo_relay_messages_fanned_out_total")).toBe(3);
    expect(valueOf(text, "weavo_relay_bytes_out_total")).toBe(30);
  });

  test("a broadcast with no recipients is not a fan-out", () => {
    const relay = make();
    relay.fanOut(0, 10);
    const text = formatPrometheus(relay.families());

    expect(valueOf(text, "weavo_relay_messages_fanned_out_total")).toBe(0);
    expect(valueOf(text, "weavo_relay_fanout_recipients_count")).toBe(0);
  });

  test("rooms are read from the source on each scrape", () => {
    let sizes = [2, 1];
    const relay = createRelayTelemetry({ roomSizes: () => sizes });

    const first = formatPrometheus(relay.families());
    sizes = [];
    const second = formatPrometheus(relay.families());

    expect(valueOf(first, "weavo_relay_rooms_active")).toBe(2);
    expect(valueOf(first, "weavo_relay_room_peers_count")).toBe(2);
    expect(valueOf(first, 'weavo_relay_room_peers_bucket{le="1"}')).toBe(1);
    expect(valueOf(first, 'weavo_relay_room_peers_bucket{le="2"}')).toBe(2);
    expect(valueOf(second, "weavo_relay_rooms_active")).toBe(0);
  });

  test("rejected upgrades only use the fixed reasons", () => {
    const relay = make();
    relay.upgradeRejected("origin");
    relay.upgradeRejected("origin");
    const text = formatPrometheus(relay.families());

    expect(
      valueOf(text, 'weavo_relay_rejected_upgrades_total{reason="origin"}'),
    ).toBe(2);
    expect(
      valueOf(text, 'weavo_relay_rejected_upgrades_total{reason="method"}'),
    ).toBe(0);
  });

  test("fan-out histogram places each broadcast by recipient count", () => {
    const relay = make();
    relay.fanOut(2, 1);
    relay.fanOut(40, 1);
    const text = formatPrometheus(relay.families());

    expect(valueOf(text, 'weavo_relay_fanout_recipients_bucket{le="1"}')).toBe(
      0,
    );
    expect(valueOf(text, 'weavo_relay_fanout_recipients_bucket{le="2"}')).toBe(
      1,
    );
    expect(valueOf(text, 'weavo_relay_fanout_recipients_bucket{le="64"}')).toBe(
      2,
    );
    expect(
      valueOf(text, 'weavo_relay_fanout_recipients_bucket{le="+Inf"}'),
    ).toBe(2);
    expect(valueOf(text, "weavo_relay_fanout_recipients_sum")).toBe(42);
  });

  test("the only label names are the fixed reasons and bucket bounds", () => {
    const relay = make([3, 1]);
    relay.upgradeRejected("origin");
    relay.fanOut(2, 1);
    const text = formatPrometheus(relay.families());

    const labelNames = new Set(
      [...text.matchAll(/([a-zA-Z_]+)="/g)].map((m) => m[1]),
    );
    expect([...labelNames].sort()).toEqual(["le", "reason"]);
  });
});
