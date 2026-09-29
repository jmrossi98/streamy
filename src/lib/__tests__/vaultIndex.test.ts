import { describe, expect, it } from "vitest";
import { searchDocs } from "../docsRetrieval";
import { chunkNote, indexNotes } from "../vaultIndex";

describe("chunkNote", () => {
  it("splits on headings and titles each chunk", () => {
    const chunks = chunkNote("Homelab/Overview.md", "intro\n# Network\nPi-hole on mediabox\n## DNS\nunbound upstream");
    expect(chunks.map((c) => c.title)).toEqual(["Overview", "Overview > Network", "Overview > DNS"]);
    expect(chunks[2].text).toContain("unbound upstream");
  });
});

describe("indexNotes + searchDocs", () => {
  it("finds the note that answers the question", () => {
    const index = indexNotes([
      { path: "Homelab/DNS.md", text: "# DNS\nPi-hole forwards to unbound on the mediabox." },
      { path: "Ideas/Books.md", text: "# Books\nComics support for Streamy someday." },
    ]);
    const [top] = searchDocs(index, "what does pihole forward to unbound");
    expect(top.chunk.path).toBe("Homelab/DNS.md");
  });
});
