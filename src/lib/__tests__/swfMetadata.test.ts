import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { parseSwfMetadata } from "../swfMetadata";

/**
 * Builds a SWF by hand rather than committing a binary fixture -- the header is
 * small and fully specified, and a hand-built one can be varied per test.
 */
function buildSwf(opts: {
  signature?: "FWS" | "CWS" | "ZWS";
  version?: number;
  widthPx?: number;
  heightPx?: number;
  frameRate?: number;
  numFrames?: number;
  /** Appended after the header, as (tagCode, payload) pairs. */
  tags?: [number, Buffer][];
} = {}): Buffer {
  const {
    signature = "FWS", version = 8, widthPx = 640, heightPx = 400,
    frameRate = 30, numFrames = 933, tags = [],
  } = opts;

  // RECT with a fixed 15-bit field width: 5 + 15*4 = 65 bits -> 9 bytes.
  const nbits = 15;
  const twips = (px: number) => px * 20;
  const bits =
    nbits.toString(2).padStart(5, "0") +
    [0, twips(widthPx), 0, twips(heightPx)]
      .map((v) => v.toString(2).padStart(nbits, "0"))
      .join("");
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
  const rect = Buffer.from(
    (padded.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2))
  );

  const rateAndFrames = Buffer.alloc(4);
  rateAndFrames.writeUInt16LE(Math.round(frameRate * 256), 0);
  rateAndFrames.writeUInt16LE(numFrames, 2);

  const tagBuffers = tags.map(([code, payload]) => {
    const header = Buffer.alloc(2);
    header.writeUInt16LE((code << 6) | Math.min(payload.length, 0x3e), 0);
    return Buffer.concat([header, payload]);
  });
  const end = Buffer.alloc(2); // End tag: code 0, length 0

  const body = Buffer.concat([rect, rateAndFrames, ...tagBuffers, end]);
  const head = Buffer.alloc(8);
  head.write(signature, 0, "latin1");
  head.writeUInt8(version, 3);
  head.writeUInt32LE(8 + body.length, 4);

  return Buffer.concat([head, signature === "CWS" ? deflateSync(body) : body]);
}

describe("parseSwfMetadata", () => {
  // Matches the real sample (thegamegame.swf): CWS, SWF 8, 640x400, 30fps,
  // 933 frames, AS2 -- verified against the actual file.
  it("reads a compressed SWF's header", () => {
    const m = parseSwfMetadata(buildSwf({ signature: "CWS" }));
    expect(m).toMatchObject({
      width: 640,
      height: 400,
      frameRate: 30,
      numFrames: 933,
      swfVersion: 8,
      compression: "zlib",
      isActionScript3: false,
    });
  });

  it("reads an uncompressed SWF's header", () => {
    const m = parseSwfMetadata(buildSwf({ signature: "FWS" }));
    expect(m?.compression).toBe("none");
    expect(m?.width).toBe(640);
  });

  // Frame rate is 8.8 fixed point, not an integer -- reading it as one gives
  // nonsense like 7680fps.
  it("decodes a fractional frame rate", () => {
    expect(parseSwfMetadata(buildSwf({ frameRate: 23.5 }))?.frameRate).toBe(23.5);
  });

  it("handles non-square and small stages", () => {
    const m = parseSwfMetadata(buildSwf({ widthPx: 320, heightPx: 240 }));
    expect(m).toMatchObject({ width: 320, height: 240 });
  });

  describe("ActionScript 3 detection", () => {
    // The signal that matters: Ruffle's AS3 support is incomplete, so this is
    // what decides whether a game is likely to run at all.
    it("is false for AS1/AS2, the path Ruffle handles best", () => {
      expect(parseSwfMetadata(buildSwf())?.isActionScript3).toBe(false);
    });

    it("detects it from the FileAttributes flag", () => {
      const attrs = Buffer.from([0x08, 0, 0, 0]); // bit 3 = ActionScript3
      expect(parseSwfMetadata(buildSwf({ tags: [[69, attrs]] }))?.isActionScript3).toBe(true);
    });

    // A DoABC tag is AS3 bytecode, whatever the flags claim -- and
    // FileAttributes only exists from SWF 8, so older files need this path.
    it("detects it from a DoABC tag even with no FileAttributes", () => {
      for (const code of [72, 82]) {
        const swf = buildSwf({ version: 7, tags: [[code, Buffer.alloc(4)]] });
        expect(parseSwfMetadata(swf)?.isActionScript3).toBe(true);
      }
    });

    it("is not fooled by an unrelated tag", () => {
      const swf = buildSwf({ tags: [[9, Buffer.from([0xff, 0xff, 0xff])]] });
      expect(parseSwfMetadata(swf)?.isActionScript3).toBe(false);
    });

    it("is not fooled by FileAttributes without the flag set", () => {
      const swf = buildSwf({ tags: [[69, Buffer.from([0x01, 0, 0, 0])]] });
      expect(parseSwfMetadata(swf)?.isActionScript3).toBe(false);
    });
  });

  describe("things that aren't a usable SWF", () => {
    // An import folder legitimately contains non-SWF files; that's not an
    // error worth failing a run over.
    it("returns null rather than throwing", () => {
      for (const junk of [
        Buffer.alloc(0),
        Buffer.from("not a swf at all"),
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), // a zip
      ]) {
        expect(() => parseSwfMetadata(junk)).not.toThrow();
        expect(parseSwfMetadata(junk)).toBeNull();
      }
    });

    it("returns null for a truncated header", () => {
      expect(parseSwfMetadata(buildSwf().subarray(0, 6))).toBeNull();
    });

    it("returns null for a CWS whose body isn't really deflate", () => {
      const broken = Buffer.concat([buildSwf({ signature: "CWS" }).subarray(0, 8), Buffer.from("garbage")]);
      expect(parseSwfMetadata(broken)).toBeNull();
    });

    // LZMA is rare and Node can't inflate it -- an honest null beats half an
    // answer, and Ruffle can still play the file.
    it("returns null for LZMA rather than guessing", () => {
      expect(parseSwfMetadata(buildSwf({ signature: "ZWS" }))).toBeNull();
    });
  });
});
