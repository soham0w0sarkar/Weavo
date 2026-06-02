import type { Message, RawTransport, Transport } from "./types";

export const createTransport = (raw: RawTransport): Transport => {
  return {
    connect: raw.connect,
    disconnect: raw.disconnect,

    send(message) {
      raw.send(JSON.stringify(message));
    },

    onMessage(cb) {
      return raw.onMessage((data) => {
        const message = JSON.parse(data) as Message;

        cb(message);
      });
    },

    onOpen: raw.onOpen,
    onClose: raw.onClose,
  };
};
