import Image from "next/image";
import { DemoRoom } from "./DemoRoom";
import logo from "./icon.png";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              src={logo}
              alt=""
              className={styles.logo}
              priority
            />
            <h1 className={styles.title}>Weavo</h1>
          </div>
        </header>
        <DemoRoom />
      </main>
    </div>
  );
}
