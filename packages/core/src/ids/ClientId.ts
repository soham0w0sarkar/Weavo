import type { ClientId } from "./types";

export const generateClientId = (): ClientId => {
  return crypto.randomUUID();
};
