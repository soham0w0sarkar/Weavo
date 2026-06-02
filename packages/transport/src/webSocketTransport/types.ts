export type Unsubscribe = () => void;

export type webSocketTransport = {
  connect(): void;
  disconnect(): void;

  send(data: string): void;

  onMessage(cb: (data: string) => void): Unsubscribe;
  onOpen(cb: () => void): Unsubscribe;
  onClose(cb: () => void): Unsubscribe;
};