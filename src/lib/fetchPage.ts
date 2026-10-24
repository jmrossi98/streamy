/**
 * The admin chat's fetch_page tool: GET a public page, return readable text.
 *
 * The SSRF rules are in fetchPageRules.ts. The part that has to live here is
 * where DNS is checked: in the connection's own lookup, so the address that
 * was checked is the address that is dialled. Checking with a separate
 * lookup first and then letting fetch resolve again is the DNS-rebinding
 * hole -- a name that answers 1.2.3.4 to the check and 100.84.77.56 to the
 * connect. Redirects are followed by hand so every hop goes through
 * checkUrl and the same lookup.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import {
  charsetOf,
  checkUrl,
  extractReadable,
  FETCH_TIMEOUT_MS,
  isPublicAddress,
  isTextual,
  MAX_BODY_BYTES,
  MAX_PAGE_CHARS,
  MAX_REDIRECTS,
  truncate,
} from "./fetchPageRules";

export type FetchedPage =
  | { ok: true; url: string; title: string; text: string; links: string[] }
  | { ok: false; url: string; error: string };

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup, refusing any answer that isn't a public address. */
export function guardedLookup(hostname: string, options: object, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) {
      const e = new Error(`${hostname} resolves to a private or reserved address`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, []);
    }
    // undici asks for one address unless told otherwise; answer in the shape
    // that was asked for.
    if ((options as { all?: boolean }).all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: FETCH_TIMEOUT_MS } });

const USER_AGENT = "Mozilla/5.0 (compatible; StreamyAssistant/1.0; +https://streamy-app.com)";

export async function fetchPage(raw: string, opts: { maxChars?: number; signal?: AbortSignal } = {}): Promise<FetchedPage> {
  const maxChars = opts.maxChars ?? MAX_PAGE_CHARS;
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const verdict = checkUrl(current);
      if (!verdict.ok) return { ok: false, url: current, error: `refused: ${verdict.reason}` };

      const res = await undiciFetch(verdict.url.toString(), {
        dispatcher: agent,
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return { ok: false, url: current, error: `HTTP ${res.status} with no Location` };
        current = new URL(location, verdict.url).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, url: current, error: `HTTP ${res.status}` };
      }
      const type = res.headers.get("content-type");
      if (!isTextual(type)) {
        await res.body?.cancel();
        return { ok: false, url: current, error: `not a text page (${type})` };
      }

      // undici's stream type is node:stream/web's, not the DOM lib's; same object.
      const bytes = await readCapped(res.body as unknown as ReadableStream<Uint8Array> | null, MAX_BODY_BYTES);
      const body = new TextDecoder(charsetOf(type)).decode(bytes);
      if (/html|xml/i.test(type ?? "") || /^\s*</.test(body)) {
        const page = extractReadable(body, current, maxChars);
        return { ok: true, url: current, ...page };
      }
      return { ok: true, url: current, title: "", text: truncate(body.trim(), maxChars), links: [] };
    }
    return { ok: false, url: current, error: `more than ${MAX_REDIRECTS} redirects` };
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const blocked = cause?.code === "EBLOCKED" || /private or reserved/.test(cause?.message ?? "");
    const message = blocked
      ? `refused: ${cause?.message ?? "private address"}`
      : cause?.message ?? (err instanceof Error ? err.message : String(err));
    return { ok: false, url: current, error: timeout.aborted ? "timed out after 10 s" : message };
  }
}

/** Reads at most `cap` bytes, then stops the download -- a long page is truncated, not refused. */
async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - size;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    size += Math.min(value.byteLength, room);
    if (size >= cap) {
      await reader.cancel();
      break;
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
