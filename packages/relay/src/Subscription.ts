import type { TextChange } from "./types";

export const createSubscription = () => {
  const listeners = new Set<(change: TextChange) => void>();

  const subscribe = (fn: (change: TextChange) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const emit = (change: TextChange) => {
    listeners.forEach((fn) => fn(change));
  };

  return { subscribe, emit };
};
