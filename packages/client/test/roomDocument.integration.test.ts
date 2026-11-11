import "./setup";
import { describe, expect, test } from "bun:test";
import { createWeavo } from "../src/Document";
import { textareaAdapter } from "../../textarea-adapter/src";
import {
  createTextarea,
  flushMicrotasks,
  insertText,
  waitUntilJoined,
} from "./helpers/editor";
import { MemoryRoom } from "./helpers/memoryTransport";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("room document before peer sync", () => {
  test("joiner applies the database before catching up from peers", async () => {
    const room = new MemoryRoom();
    const founder = createWeavo(room.join(), {
      adapter: textareaAdapter,
      foundingGraceMs: 0,
      heartbeatIntervalMs: 0,
    });
    const founderEl = createTextarea();
    founder.bind(founderEl);
    await waitUntilJoined(founder);
    insertText(founderEl, "stored");
    const snapshot = founder.snapshot();
    insertText(founderEl, "!");

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const joiner = createWeavo(room.join(), {
      adapter: textareaAdapter,
      foundingGraceMs: 5_000,
      heartbeatIntervalMs: 0,
      loadDocument: () => gate.then(() => ({ snapshot, delta: [] })),
    });
    const joinerEl = createTextarea();
    joiner.bind(joinerEl);

    await flushMicrotasks();
    expect(joinerEl.value).toBe("");
    expect(joiner.membership.isJoined()).toBe(false);

    release();
    await gate;
    await settle();
    expect(joinerEl.value).toBe("stored");

    await waitUntilJoined(joiner);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(joinerEl.value).toBe("stored!");
    expect(founderEl.value).toBe("stored!");

    founder.disconnect();
    joiner.disconnect();
    founderEl.remove();
    joinerEl.remove();
  });

  test("no stored document still syncs from peers", async () => {
    const room = new MemoryRoom();
    const founder = createWeavo(room.join(), {
      adapter: textareaAdapter,
      foundingGraceMs: 0,
      heartbeatIntervalMs: 0,
    });
    const founderEl = createTextarea();
    founder.bind(founderEl);
    await waitUntilJoined(founder);
    insertText(founderEl, "hi");

    const joiner = createWeavo(room.join(), {
      adapter: textareaAdapter,
      foundingGraceMs: 5_000,
      heartbeatIntervalMs: 0,
      loadDocument: async () => null,
    });
    const joinerEl = createTextarea();
    joiner.bind(joinerEl);
    await waitUntilJoined(joiner);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(joinerEl.value).toBe("hi");

    founder.disconnect();
    joiner.disconnect();
    founderEl.remove();
    joinerEl.remove();
  });
});
