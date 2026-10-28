import type { Metadata } from "next";
import styles from "../../prose.module.css";

export const metadata: Metadata = {
  title: "@weavo/monaco-adapter",
};

export default function MonacoAdapterPage() {
  return (
    <article className={styles.prose}>
      <h1 className={styles.title}>@weavo/monaco-adapter</h1>
      <p className={styles.subtitle}>
        Monaco model changes become Weavo operations; remote operations update
        the model without echoing into the local path.
      </p>

      <h2 className={styles.h2}>Install</h2>
      <pre className={styles.pre}>
        <code>
          npm install @weavo/client @weavo/monaco-adapter monaco-editor
        </code>
      </pre>

      <h2 className={styles.h2}>Bind</h2>
      <pre className={styles.pre}>
        <code>{`import { createWeavo } from "@weavo/client";
import { monacoAdapter } from "@weavo/monaco-adapter";

const weavo = createWeavo(url, { adapter: monacoAdapter });
const unbind = weavo.bind(editor);`}</code>
      </pre>

      <p className={styles.p}>
        Positions are converted through Monaco&apos;s UTF-16 model offsets.
        Multi-cursor edit batches apply from the highest offset down, selections
        transform across remote edits, and IME composition commits once.
      </p>
    </article>
  );
}
