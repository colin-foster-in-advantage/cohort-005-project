import { describe, it, expect } from "vitest";
import { noteDraft } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("noteDraft", () => {
  it("cannot be saved when empty or only whitespace", () => {
    expect(noteDraft("")).toMatchObject({
      length: 0,
      empty: true,
      canSave: false,
    });
    expect(noteDraft("   \n ")).toMatchObject({
      length: 0,
      empty: true,
      canSave: false,
    });
  });

  it("counts the trimmed text against the note limit", () => {
    const draft = noteDraft("  hello  ");
    expect(draft).toMatchObject({
      length: 5,
      limit: MAX_NOTE_LENGTH,
      empty: false,
      tooLong: false,
      canSave: true,
    });
  });

  it("allows exactly the limit", () => {
    expect(noteDraft("a".repeat(MAX_NOTE_LENGTH))).toMatchObject({
      tooLong: false,
      canSave: true,
    });
  });

  it("blocks saving one character over the limit", () => {
    expect(noteDraft("a".repeat(MAX_NOTE_LENGTH + 1))).toMatchObject({
      length: MAX_NOTE_LENGTH + 1,
      tooLong: true,
      canSave: false,
    });
  });

  it("cannot be saved when nothing changed since the last save", () => {
    expect(noteDraft("my note", "my note")).toMatchObject({
      dirty: false,
      canSave: false,
    });
    expect(noteDraft("my note ", "my note")).toMatchObject({
      dirty: false,
      canSave: false,
    });
    expect(noteDraft("my note", "my note\n")).toMatchObject({
      dirty: false,
      canSave: false,
    });
  });

  it("can be saved once it differs from the saved note", () => {
    expect(noteDraft("my note, edited", "my note")).toMatchObject({
      dirty: true,
      canSave: true,
    });
  });

  it("treats a first note, with nothing saved yet, as a change", () => {
    expect(noteDraft("Stryker was here!")).toMatchObject({
      dirty: true,
      canSave: true,
    });
  });
});
