import { DemoRoom } from "./DemoRoom";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.demo}>
          <h1 className={styles.title}>Relay demo</h1>
          <DemoRoom />
        </div>
      </main>
    </div>
  );
}
