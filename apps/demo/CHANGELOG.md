# demo

## 2.1.0

### Minor Changes

- Textarea page is as wide as the Monaco page, and the textarea itself is taller
- Presence chips above the textarea have the same gap the Monaco toolbar already had
- The Textarea / Monaco switch stays in the lobby. It is gone once you are in a room
- Monaco no longer broadcasts diagnostics. Each editor shows its own language-service errors

## 2.0.0

### Major Changes

- Monaco room with IntelliSense, sharing the lobby room with the textarea
- Remote carets move when that author's insert lands, instead of waiting for the next heartbeat
- Native textarea binding lives in `@weavo/textarea-adapter`
- Tombstones are swept from the heartbeat GC frontier

## 0.1.9

### Patch Changes

- Updated dependencies
  - @weavo/client@2.0.0
  - @weavo/transport@2.0.0

## 0.1.6

### Patch Changes

- Updated dependencies
  - @weavo/client@1.2.2

## 0.1.5

### Patch Changes

- Updated dependencies
  - @weavo/client@1.2.1

## 0.1.4

### Patch Changes

- Updated dependencies
  - @weavo/client@1.2.0

## 0.1.3

### Patch Changes

- Updated dependencies
  - @weavo/client@1.1.0

## 0.1.2

### Patch Changes

- Updated dependencies
  - @weavo/client@1.0.3

## 0.1.1

### Patch Changes

- Updated dependencies [ad2c8ae]
  - @weavo/client@1.0.2
