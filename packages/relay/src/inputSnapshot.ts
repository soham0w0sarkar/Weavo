export type InputSnapshot = { start: number; end: number; value: string };

/** Find the edited region by diffing pre- and post-edit text. */
export const reconcileBefore = (
  before: InputSnapshot,
  newValue: string,
  inputType: string,
): InputSnapshot => {
  const oldVal = before.value;
  if (oldVal === newValue) return before;

  let start = 0;
  while (
    start < oldVal.length &&
    start < newValue.length &&
    oldVal[start] === newValue[start]
  ) {
    start++;
  }

  let endOld = oldVal.length;
  let endNew = newValue.length;
  while (
    endOld > start &&
    endNew > start &&
    oldVal[endOld - 1] === newValue[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }

  if (inputType === "deleteContentBackward") {
    return { start: endOld, end: endOld, value: oldVal };
  }

  if (inputType === "deleteContentForward") {
    return { start, end: start, value: oldVal };
  }

  return { start, end: endOld, value: oldVal };
};
