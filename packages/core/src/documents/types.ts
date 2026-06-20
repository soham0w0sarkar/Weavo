import type { ClientId } from "../ids/types";
import type { Operation } from "../operations";
import type { SkipList } from "../skipList/types";
import type { NodeStore } from "../store/types";

export type Document = {
  clientId: ClientId;
  counter: number;
  store: NodeStore;
  skipList: SkipList;
};

export type OnApplied = (operation: Operation) => void;

export type Before = {
  start: number;
  end: number;
  value: string;
} | null;
