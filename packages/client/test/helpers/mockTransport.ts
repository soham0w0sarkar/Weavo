import type { Message, Transport } from "@weavo/transport";

export const createMockTransport = () => {
  const sent: Message[] = [];
  const messageHandlers = new Set<(message: Message) => void>();
  const openHandlers = new Set<() => void>();

  const transport: Transport = {
    connect() {
      for (const cb of openHandlers) cb();
    },
    disconnect() {},
    send(message) {
      sent.push(message);
    },
    onMessage(cb) {
      messageHandlers.add(cb);
      return () => messageHandlers.delete(cb);
    },
    onOpen(cb) {
      openHandlers.add(cb);
      return () => openHandlers.delete(cb);
    },
    onClose(cb) {
      return () => {};
    },
  };

  const deliver = (message: Message) => {
    for (const cb of messageHandlers) cb(message);
  };

  return { transport, sent, deliver };
};
