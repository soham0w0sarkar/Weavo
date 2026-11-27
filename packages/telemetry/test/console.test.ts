import { describe, expect, test } from "bun:test";
import {
  createClientTelemetry,
  formatSnapshot,
  startConsoleExporter,
} from "../src";

describe("console exporter", () => {
  test("a fresh collector prints all zero and an empty histogram line", () => {
    const text = formatSnapshot(createClientTelemetry().snapshot());

    expect(text).toContain("counters   (all zero)");
    expect(text).toContain("histograms (empty)");
    expect(text).toContain("buffer.depth=0");
  });

  test("prints only counters that moved, and the buckets that hold samples", () => {
    const { hook, snapshot } = createClientTelemetry();
    hook.count("op.buffered:missing-origin");
    hook.count("op.flushed");
    hook.record("buffer.wait_ms", 40);
    hook.record("buffer.wait_ms", 5_000);

    const text = formatSnapshot(snapshot());

    expect(text).toContain("op.buffered:missing-origin=1  op.flushed=1");
    expect(text).not.toContain("op.duplicate");
    expect(text).toContain("buffer.wait_ms n=2 sum=5040 [<=64:1 >1000:1]");
  });

  test("prints a snapshot on every tick until stopped", async () => {
    const collector = createClientTelemetry();
    const lines: string[] = [];
    const stop = startConsoleExporter(collector, {
      intervalMs: 10,
      log: (text) => lines.push(text),
    });

    await Bun.sleep(45);
    collector.hook.count("op.flushed");
    await Bun.sleep(25);
    stop();
    const printed = lines.length;
    await Bun.sleep(30);

    expect(printed).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBe(printed);
    expect(lines[0]).toContain("(all zero)");
    expect(lines.at(-1)).toContain("op.flushed=1");
  });
});
