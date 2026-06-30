import { DemoRoom } from "./DemoRoom";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>Relay</h1>
        </header>
        <DemoRoom />
      </main>
    </div>
  );
}
