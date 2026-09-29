import { describe, expect, it } from "vitest";
import { encodeVaultPath, isReadableNote, parsePropfind } from "../vaultRules";

// Shape of the real mod_dav response from the mediabox share.
const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
<D:response xmlns:lp1="DAV:"><D:href>/Resume/</D:href><D:propstat><D:prop>
<lp1:resourcetype><D:collection/></lp1:resourcetype>
<lp1:getlastmodified>Mon, 14 Sep 2026 14:44:10 GMT</lp1:getlastmodified></D:prop></D:propstat></D:response>
<D:response xmlns:lp1="DAV:"><D:href>/Resume/Master%20Resume.md</D:href><D:propstat><D:prop>
<lp1:resourcetype/><lp1:getlastmodified>Tue, 29 Sep 2026 10:00:00 GMT</lp1:getlastmodified></D:prop></D:propstat></D:response>
<D:response xmlns:lp1="DAV:"><D:href>/Resume/Projects/</D:href><D:propstat><D:prop>
<lp1:resourcetype><D:collection/></lp1:resourcetype></D:prop></D:propstat></D:response>
</D:multistatus>`;

describe("parsePropfind", () => {
  it("lists entries under the folder, decoded, without the folder itself", () => {
    expect(parsePropfind(xml, "Resume")).toEqual([
      { path: "Resume/Master Resume.md", isDir: false, modified: "Tue, 29 Sep 2026 10:00:00 GMT" },
      { path: "Resume/Projects/", isDir: true, modified: null },
    ]);
  });
});

describe("isReadableNote", () => {
  it("allows ordinary notes", () => {
    expect(isReadableNote("Resume/Master Resume.md")).toBe(true);
  });
  it("refuses traversal, absolute paths, hidden folders and non-notes", () => {
    for (const p of ["../etc/passwd.md", "/Resume/a.md", ".obsidian/workspace.md", "Resume/.trash/x.md", "Resume/photo.png", ""]) {
      expect(isReadableNote(p)).toBe(false);
    }
  });
});

describe("encodeVaultPath", () => {
  it("encodes segments and keeps slashes", () => {
    expect(encodeVaultPath("Resume/Master Resume.md")).toBe("Resume/Master%20Resume.md");
  });
});
