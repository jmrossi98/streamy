import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  README_PATH,
  noteFileName,
  noteFolder,
  parseJsonStream,
  parseLooseDate,
  parseNotesPayload,
  planFiles,
  planSync,
  renderNote,
  type IncomingNote,
} from "./appleNotesRules";
import { isWritableVaultPath } from "./sharedVaultRules";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const note = (title: string, body = `${title}\nbody`, folder = "Notes", created: string | null = null): IncomingNote => ({
  title,
  body,
  folder,
  created,
  modified: null,
});

describe("parsing what Shortcuts sends", () => {
  it("reads a JSON array, a {notes} object, and dictionaries back to back", () => {
    const one = { title: "A", body: "a" };
    const two = { Name: "B", Body: "b", Folder: "Recipes" };
    expect(parseNotesPayload(JSON.stringify([one, two]))).toHaveLength(2);
    expect(parseNotesPayload(JSON.stringify({ notes: [one, two] }))).toHaveLength(2);
    // A list of dictionaries used as text: one JSON object per line, pretty or not.
    const stream = `${JSON.stringify(one, null, 2)}\n${JSON.stringify(two)}`;
    const notes = parseNotesPayload(stream);
    expect(notes.map((n) => n.title)).toEqual(["A", "B"]);
    expect(notes[1].folder).toBe("Recipes");
  });

  it("matches keys loosely and skips empty entries", () => {
    const [n] = parseNotesPayload(JSON.stringify([{ "Last Modified Date": "2026-10-24T15:12:00Z", name: "X", text: "y" }, {}]));
    expect(n).toMatchObject({ title: "X", body: "y", modified: "2026-10-24T15:12:00.000Z" });
    expect(parseNotesPayload("[{}]")).toEqual([]);
  });

  it("keeps braces inside strings from confusing the stream", () => {
    expect(parseJsonStream('{"a":"} {"}{"b":"\\"}"}')).toEqual([{ a: "} {" }, { b: '"}' }]);
    expect(parseJsonStream("not json")).toEqual([]);
  });

  it("parses the dates Shortcuts writes as text", () => {
    expect(parseLooseDate("Oct 24, 2026 at 3:12 PM")).not.toBeNull();
    expect(parseLooseDate("Oct 24, 2026 at 3:12 PM")).not.toBeNull();
    expect(parseLooseDate("2026-10-24T15:12:00Z")).toBe("2026-10-24T15:12:00.000Z");
    expect(parseLooseDate("someday")).toBeNull();
  });
});

describe("files", () => {
  it("names files after the title, minus what a path can't hold", () => {
    expect(noteFileName("Groceries / week 3: #1")).toBe("Groceries week 3 1");
    expect(noteFileName("   ")).toBe("Untitled");
    expect(noteFileName("..hidden")).toBe("hidden");
    expect(noteFolder("Recipes & Food")).toBe("recipes-food");
    expect(noteFolder("")).toBe("notes");
  });

  it("puts each note in its folder, numbering same-named notes by age", () => {
    const files = planFiles([
      note("List", "List\nnewer", "Notes", "2026-02-01T00:00:00.000Z"),
      note("List", "List\nolder", "Notes", "2026-01-01T00:00:00.000Z"),
      note("Pasta", undefined, "Recipes"),
    ]);
    expect([...files.keys()].sort()).toEqual([
      "main/apple-notes/notes/List (2).md",
      "main/apple-notes/notes/List.md",
      "main/apple-notes/recipes/Pasta.md",
    ]);
    expect(files.get("main/apple-notes/notes/List.md")).toContain("older");
    for (const p of files.keys()) expect(isWritableVaultPath(p)).toBe(true);
  });

  it("renders frontmatter and the body", () => {
    const md = renderNote({ ...note("T", 'He said "hi"\r\nline'), created: "2026-01-01T00:00:00.000Z" });
    expect(md).toContain('folder: "Notes"');
    expect(md).toContain("created: 2026-01-01T00:00:00.000Z");
    expect(md.endsWith('He said "hi"\nline\n')).toBe(true);
  });

  it("allows writes only inside the mirror, one folder deep", () => {
    expect(isWritableVaultPath("main/apple-notes/a/b/c.md")).toBe(false);
    expect(isWritableVaultPath("main/apple-notes/../resume/x.md")).toBe(false);
    expect(isWritableVaultPath("main/resume/x.md")).toBe(false);
    expect(isWritableVaultPath(README_PATH)).toBe(true);
  });
});

describe("planSync", () => {
  const files = planFiles([note("A"), note("B"), note("C")]);
  const paths = [...files.keys()];

  it("writes everything the first time", () => {
    const plan = planSync(files, [], {}, sha);
    expect(plan.writes).toHaveLength(3);
    expect(plan.deletes).toEqual([]);
  });

  it("writes only what changed, and rewrites a file someone deleted", () => {
    const first = planSync(files, [], {}, sha);
    const changed = planFiles([note("A", "A\nedited"), note("B"), note("C")]);
    const plan = planSync(changed, paths.filter((p) => !p.endsWith("C.md")), first.manifest, sha);
    expect(plan.writes.map((w) => w.path.split("/").pop()).sort()).toEqual(["A.md", "C.md"]);
    expect(plan.unchanged).toBe(1);
  });

  it("deletes notes that are gone from the phone, never the README", () => {
    const plan = planSync(planFiles([note("A"), note("B")]), [...paths, README_PATH], {}, sha);
    expect(plan.deletes.map((p) => p.split("/").pop())).toEqual(["C.md"]);
  });

  it("holds back deletions when the phone suddenly sends far fewer notes", () => {
    const many = planFiles(Array.from({ length: 20 }, (_, i) => note(`N${i}`)));
    const plan = planSync(planFiles([note("N0")]), [...many.keys()], {}, sha);
    expect(plan.deletes).toEqual([]);
    expect(plan.heldBack).toBe(19);
  });
});
