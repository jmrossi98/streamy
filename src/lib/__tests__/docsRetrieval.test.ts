import { describe, it, expect } from "vitest";
import { searchDocs, buildDocsContextBlock } from "../docsRetrieval";

const index = {
  generatedAt: "",
  chunks: [
    { id: "1", repo: "infra", path: "README.md", title: "Port forwarding",
      text: "PIA forwards ports in zero US regions. gluetun panics doing PIA port forwarding." },
    { id: "2", repo: "infra", path: "README.md", title: "Disk pressure",
      text: "IO pressure took the exit node down when the disk was 91 percent full." },
    { id: "3", repo: "streamy", path: "docs/x.md", title: "Unrelated",
      text: "The quick brown fox and the lazy dog and some other words entirely." },
  ],
  // gluetun is rare, "the" is everywhere -- which is the whole point of idf.
  df: { pia: 1, gluetun: 1, ports: 1, disk: 1, pressure: 1, words: 1 },
};

describe("searchDocs", () => {
  it("ranks the chunk that actually answers the question first", () => {
    const hits = searchDocs(index, "why does port forwarding fail with gluetun");
    expect(hits[0].chunk.id).toBe("1");
  });

  it("scores an unrelated chunk at zero rather than ranking it low", () => {
    const hits = searchDocs(index, "gluetun");
    expect(hits.every((h) => h.chunk.id !== "3")).toBe(true);
  });

  it("returns nothing for a query of only stopwords", () => {
    expect(searchDocs(index, "why is the it")).toEqual([]);
  });

  it("boosts a title match over a body-only match", () => {
    const hits = searchDocs(index, "disk pressure");
    expect(hits[0].chunk.title).toBe("Disk pressure");
  });
});

describe("buildDocsContextBlock", () => {
  // Handing a 3B four irrelevant pages is worse than handing it none: it
  // will use them, and confidently.
  it("drops weak matches rather than padding the prompt", () => {
    expect(buildDocsContextBlock([{ chunk: index.chunks[2], score: 0.4 }])).toBeNull();
  });

  it("cites the file and tells the model to admit a gap", () => {
    const b = buildDocsContextBlock([{ chunk: index.chunks[0], score: 9 }])!;
    expect(b).toMatch(/infra\/README\.md/);
    expect(b).toMatch(/say so rather than filling the gap/);
  });
});
