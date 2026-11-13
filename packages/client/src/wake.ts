/** Calls `onWake` when a hidden tab becomes visible or the browser comes back online. No-op outside a browser. */
export const subscribeWake = (onWake: () => void): (() => void) => {
  const doc = typeof document !== "undefined" ? document : undefined;
  const win = typeof window !== "undefined" ? window : undefined;

  const onVisibility = () => {
    if (doc?.visibilityState === "visible") onWake();
  };

  doc?.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("online", onWake);

  return () => {
    doc?.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("online", onWake);
  };
};
