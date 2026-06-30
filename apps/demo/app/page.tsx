import { RelayTextarea } from "./RelayTextarea";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.demo}>
          <h1 className={styles.title}>Relay demo</h1>
          <p className={styles.subtitle}>
            Two editors sharing one document over WebSocket. Type in either box
            to see changes sync live.
          </p>
          <div className={styles.editors}>
            <RelayTextarea label="Editor A" />
            <RelayTextarea label="Editor B" />
          </div>
        </div>
      </main>
    </div>
  );
}
