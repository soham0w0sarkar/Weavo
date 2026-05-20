import { ROOT_ID } from "../ids";
import type { ClientId } from "../ids/types";
import { createSkipList } from "../skipList";
import { createNode, createNodeStore } from "../store";
import type { Document } from "./types";

export const createReplica = (clientId: ClientId): Document => {
  const rootNode = createNode(ROOT_ID, "", false, null, null);
  return {
    clientId,
    counter: 0,
    store: createNodeStore(rootNode),
    skipList: createSkipList(rootNode),
  };
};
