import type { Metadata } from "next";
import styles from "../../prose.module.css";

export const metadata: Metadata = {
  title: "@weavo/client",
};

export default function ClientPackagePage() {
  return (
    <article className={styles.prose}>
      <h1 className={styles.title}>@weavo/client</h1>
      <p className={styles.subtitle}>
        Browser facade: membership join gate, sync, presence, and an adapter
        host for editors.
      </p>

      <h2 className={styles.h2}>Surface</h2>
      <ul className={styles.list}>
        <li>
          <code>createWeavo(url, options?)</code> — connect and orchestrate
        </li>
        <li>
          <code>bind(target)</code> — delegates to the configured adapter
        </li>
        <li>
          <code>onPresence</code> / <code>getPresence</code> /{" "}
          <code>setIdentity</code>
        </li>
        <li>
          <code>disconnect()</code> — <code>LEAVE</code> then close the socket
        </li>
        <li>
          <code>snapshot()</code> — persistence-friendly document snapshot
        </li>
      </ul>

      <h2 className={styles.h2}>Useful options</h2>
      <pre className={styles.pre}>
        <code>{`createWeavo(url, {
  adapter: textareaAdapter,
  clientId,
  name,
  color,
  heartbeatIntervalMs,
  presenceTimeoutMs,
  removalTimeoutMs,
  initial: { snapshot, delta },
  onOp(op) { /* persist deltas */ },
});`}</code>
      </pre>

      <p className={styles.p}>
        Until <code className={styles.inlineCode}>membership.isJoined()</code>,
        the bound field stays read-only and outbound ops wait.
      </p>
    </article>
  );
}
