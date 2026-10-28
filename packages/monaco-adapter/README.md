<p align="center">
  <img src="https://raw.githubusercontent.com/soham0w0sarkar/Weavo/main/docs/assets/logo.png" width="140" alt="weavo" />
</p>

# @weavo/monaco-adapter

Bind a Monaco Editor instance to a [`@weavo/client`](https://www.npmjs.com/package/@weavo/client) document. Local model edits become CRDT operations; remote operations update the model without echoing or entering Monaco's local undo stack.

## Install

```bash
npm install @weavo/client @weavo/monaco-adapter monaco-editor
```

## Usage

```ts
import { createWeavo } from "@weavo/client";
import { monacoAdapter } from "@weavo/monaco-adapter";
import * as monaco from "monaco-editor";

const editor = monaco.editor.create(container, {
  language: "typescript",
});
const weavo = createWeavo("ws://localhost:8080?room=code", {
  adapter: monacoAdapter,
});
const unbind = weavo.bind(editor);

unbind();
weavo.disconnect();
```

The adapter preserves all Monaco selections across remote edits, supports batched multi-cursor changes, commits IME composition once, publishes the primary cursor as presence, and keeps the editor read-only until membership join completes.

The bound editor must retain the same model for the lifetime of the binding. Unbind before calling `editor.setModel(...)`, then bind again.

## Related packages

| Package                    | Role                                 |
| -------------------------- | ------------------------------------ |
| `@weavo/client`            | Document, membership, sync, presence |
| `@weavo/textarea-adapter`  | Native textarea binding              |
| `@weavo/monaco-adapter`    | Monaco Editor binding                |

## Development

```bash
# from packages/monaco-adapter
bun test
bun run build
```

## License

MIT
