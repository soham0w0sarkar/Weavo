import Image from "next/image";
import { DemoRoom } from "./DemoRoom";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Image
            src="/logo.png"
            alt="Weavo"
            width={40}
            height={40}
            className={styles.logo}
            priority
          />
        </header>
        <DemoRoom />
      </main>
    </div>
  );
}
