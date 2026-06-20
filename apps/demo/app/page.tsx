import { RelayTextarea } from "./RelayTextarea";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.demo}>
          <h1 className={styles.title}>Relay demo</h1>
          <p className={styles.subtitle}>
            Collaborative editor over WebSocket. Open this page in two tabs to
            see changes sync live.
          </p>
          <RelayTextarea label="Editor" />
        </div>
      </main>
    </div>
  );
}
