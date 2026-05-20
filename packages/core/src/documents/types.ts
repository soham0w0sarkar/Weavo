import type { ClientId } from "../ids/types";
import type { SkipList } from "../skipList/types";
import type { NodeStore } from "../store/types";

export type Document = {
  clientId: ClientId;
  counter: number;
  store: NodeStore;
  skipList: SkipList;
};

