"use client";

import { useEffect, useRef } from "react";
import { createWeavo } from "@weavo/client";

export function WeavoTextarea({ weavoUrl }: { weavoUrl: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const weavo = createWeavo(weavoUrl);
    const unbind = weavo.bind(el);

    return () => {
      unbind();
      weavo.disconnect();
    };
  }, [weavoUrl]);

  return (
    <textarea
      ref={textareaRef}
      className="editor-textarea"
      defaultValue=""
      placeholder="Start typing…"
      rows={10}
      spellCheck={false}
    />
  );
}
