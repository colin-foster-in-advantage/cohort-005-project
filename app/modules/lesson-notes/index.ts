import { describeDraft, type NoteDraft } from "./lib/draft";

export type { NoteDraft };

/**
 * What the Lesson Note editor shows about the text in the box: the character
 * count against the limit, and whether Save should be enabled. It agrees with
 * `saveNote`, which trims before it checks the length.
 */
export function noteDraft(draft: string, saved = ""): NoteDraft {
  return describeDraft(draft, saved);
}
