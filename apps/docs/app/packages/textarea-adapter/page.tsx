import type { Metadata } from "next";
import styles from "../../prose.module.css";

export const metadata: Metadata = {
  title: "@weavo/textarea-adapter",
};

export default function TextareaAdapterPage() {
  return (
    <article className={styles.prose}>
      <h1 className={styles.title}>@weavo/textarea-adapter</h1>
      <p className={styles.subtitle}>
        Native textarea binding: IME composition, selection transforms, and
        remote apply. Other editors (Monaco, …) get their own adapter against
        the same <code className={styles.inlineCode}>WeavoAdapterHost</code>.
      </p>

      <h2 className={styles.h2}>Surface</h2>
      <pre className={styles.pre}>
        <code>{`import { createWeavo } from "@weavo/client";
import { textareaAdapter } from "@weavo/textarea-adapter";

const weavo = createWeavo(url, { adapter: textareaAdapter });
const unbind = weavo.bind(textarea);`}</code>
      </pre>

      <p className={styles.p}>
        Until <code className={styles.inlineCode}>weavo.isJoined()</code>, the
        field stays read-only. Unbind before attaching a different element.
      </p>
    </article>
  );
}
