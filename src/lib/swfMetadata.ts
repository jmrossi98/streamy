/**
 * Reads a SWF's header without running it.
 *
 * Ruffle exposes the same facts via MovieMetadata, but only in a browser and
 * only after the movie has loaded -- too late to be useful for an import step
 * that wants to record what a game is, size its player, and warn about it
 * before anyone clicks. All of it is in the file header, so it can be read
 * server-side at import instead.
 *
 * The one that matters most is isActionScript3. Ruffle's AS1/AS2 support is
 * its strongest path and its AS3 support is still incomplete, so this is the
 * best available predictor of whether a given game will actually run -- better
 * than Flashpoint's own `status` field, which describes real Flash Player
 * rather than Ruffle.
 */

import { inflateSync } from "node:zlib";

export type SwfMetadata = {
  /** Stage width in pixels. */
  width: number;
  /** Stage height in pixels. */
  height: number;
  frameRate: number;
  numFrames: number;
  swfVersion: number;
  /** Ruffle's weak spot -- see the note above. */
  isActionScript3: boolean;
  /** Bytes once decompressed, as the header declares it. */
  uncompressedLength: number;
  compression: "none" | "zlib" | "lzma";
};

/** Tag codes that prove ActionScript 3 regardless of what FileAttributes says. */
const DO_ABC_TAGS = new Set([72, 82]);
const FILE_ATTRIBUTES_TAG = 69;
const END_TAG = 0;
/** Bit 3 of the FileAttributes flags byte. */
const ACTION_SCRIPT_3_FLAG = 0x08;
/** SWF stores lengths and coordinates in twips. */
const TWIPS_PER_PIXEL = 20;

function compressionOf(signature: string): SwfMetadata["compression"] | null {
  if (signature === "FWS") return "none";
  if (signature === "CWS") return "zlib";
  if (signature === "ZWS") return "lzma";
  return null;
}

/**
 * The stage dimensions, stored as a variable-width bit-packed RECT.
 *
 * Five bits say how wide each of the four following fields is, so nothing here
 * is byte-aligned and the whole thing has to be read as a bit string. Returns
 * the pixel size and how many bytes the RECT consumed, since the frame rate
 * follows immediately after it.
 */
function readFrameSize(body: Buffer): { width: number; height: number; bytes: number } {
  const nbits = body[0] >> 3;
  const totalBits = 5 + nbits * 4;
  const bytes = Math.ceil(totalBits / 8);

  let bits = "";
  for (let i = 0; i < bytes; i++) bits += body[i].toString(2).padStart(8, "0");
  bits = bits.slice(5);

  const field = (i: number) => parseInt(bits.slice(i * nbits, (i + 1) * nbits), 2) || 0;
  return {
    width: Math.round((field(1) - field(0)) / TWIPS_PER_PIXEL),
    height: Math.round((field(3) - field(2)) / TWIPS_PER_PIXEL),
    bytes,
  };
}

/**
 * Walks the tag list looking for evidence of ActionScript 3.
 *
 * Two independent signals, because neither alone is reliable: FileAttributes
 * carries an explicit flag but only exists from SWF 8 onward, and a DoABC tag
 * is unambiguous proof of AS3 bytecode whatever the flags claim. Either is
 * enough.
 */
function detectActionScript3(body: Buffer, start: number): boolean {
  let pos = start;
  while (pos + 2 <= body.length) {
    const codeAndLength = body.readUInt16LE(pos);
    pos += 2;
    const code = codeAndLength >> 6;
    let length = codeAndLength & 0x3f;
    // 0x3F is the escape for a long tag, whose real length follows as a u32.
    if (length === 0x3f) {
      if (pos + 4 > body.length) return false;
      length = body.readUInt32LE(pos);
      pos += 4;
    }
    if (code === END_TAG) return false;
    if (DO_ABC_TAGS.has(code)) return true;
    if (code === FILE_ATTRIBUTES_TAG && length >= 1 && pos < body.length) {
      if ((body[pos] & ACTION_SCRIPT_3_FLAG) !== 0) return true;
    }
    pos += length;
  }
  return false;
}

/**
 * Parses a SWF's header, or returns null if it isn't one.
 *
 * Null rather than throwing: a file that isn't a SWF is an ordinary thing to
 * find in an import folder, not an error worth failing the run over. LZMA
 * bodies also return null -- the header is readable but the body isn't
 * inflatable with what Node ships, and half an answer would be worse than an
 * honest "unknown" (they are rare, and Ruffle can still play them).
 */
export function parseSwfMetadata(file: Buffer): SwfMetadata | null {
  if (file.length < 8) return null;

  const compression = compressionOf(file.subarray(0, 3).toString("latin1"));
  if (!compression) return null;

  const swfVersion = file[3];
  const uncompressedLength = file.readUInt32LE(4);

  let body: Buffer;
  if (compression === "none") {
    body = file.subarray(8);
  } else if (compression === "zlib") {
    try {
      body = inflateSync(file.subarray(8));
    } catch {
      return null;
    }
  } else {
    return null;
  }

  if (body.length < 4) return null;

  const { width, height, bytes } = readFrameSize(body);
  if (body.length < bytes + 4) return null;

  return {
    width,
    height,
    // Frame rate is an 8.8 fixed-point number, not an integer.
    frameRate: body.readUInt16LE(bytes) / 256,
    numFrames: body.readUInt16LE(bytes + 2),
    swfVersion,
    isActionScript3: detectActionScript3(body, bytes + 4),
    uncompressedLength,
    compression,
  };
}
