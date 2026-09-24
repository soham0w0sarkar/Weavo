<p align="center">
  <img src="https://raw.githubusercontent.com/soham0w0sarkar/Weavo/main/docs/assets/logo.png" width="140" alt="weavo" />
</p>

# @weavo/textarea-adapter

Bind a native `<textarea>` to a [`@weavo/client`](https://www.npmjs.com/package/@weavo/client) document. IME composition, selection transforms, and remote apply live here so other editors (Monaco, CodeMirror, …) can ship their own adapters against the same host API.

## Install

```bash
npm install @weavo/client @weavo/textarea-adapter
```

## Usage

```ts
import { createWeavo } from "@weavo/client";
import { textareaAdapter } from "@weavo/textarea-adapter";

const weavo = createWeavo("ws://localhost:8080?room=notes", {
  adapter: textareaAdapter,
});
const el = document.querySelector("textarea")!;
const unbind = weavo.bind(el);

unbind();
weavo.disconnect();
```

`textareaAdapter` supplies the internal bind implementation used by
`weavo.bind(...)`. It listens to native `beforeinput` / `input` / composition
events and applies remote updates with a transformed caret.

Until `weavo.isJoined()`, the textarea stays `readOnly`.

## Related packages

| Package                   | Role                                 |
| ------------------------- | ------------------------------------ |
| `@weavo/client`           | Document, membership, sync, presence |
| `@weavo/textarea-adapter` | Native textarea binding              |
| `@weavo/monaco-adapter`   | Monaco Editor binding                |

## Development

```bash
# from packages/textarea-adapter
bun test
bun run build
```

## License

MIT
