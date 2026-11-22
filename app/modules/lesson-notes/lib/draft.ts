import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteDraft = {
  /** Characters the server will store: it trims before it counts. */
  length: number;
  limit: number;
  empty: boolean;
  tooLong: boolean;
  canSave: boolean;
  /** True once the draft differs from the saved Note. */
  dirty: boolean;
};

export function describeDraft(draft: string, saved: string): NoteDraft {
  const length = draft.trim().length;
  const empty = length === 0;
  const tooLong = length > MAX_NOTE_LENGTH;
  const dirty = draft.trim() !== saved.trim();
  return {
    length,
    limit: MAX_NOTE_LENGTH,
    empty,
    tooLong,
    dirty,
    canSave: !empty && !tooLong && dirty,
  };
}
