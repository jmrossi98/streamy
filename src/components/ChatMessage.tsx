"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Token, Tokens } from "marked";
import { splitMessage, copyableText } from "@/lib/chatSegments";
import { lexChat, safeHref, splitTrace, traceSummary, type TraceLine } from "@/lib/chatMarkdown";

/**
 * A command the assistant suggested, with a way to get it onto the clipboard.
 *
 * Copy, deliberately, and not "run". The assistant reads web-search results and
 * service output, so a model that has been fed hostile text could suggest a
 * hostile command; a button that executed it would turn that into code running
 * on the box. A copy keeps a person between the suggestion and the shell, which
 * is the entire safety margin -- and it is why copyableText also strips the
 * trailing newline, so the paste waits at the prompt rather than self-executing.
 */
function CodeBlock({ text, lang, open }: { text: string; lang: string; open: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyableText(text));
      setCopied(true);
    } catch {
      // Clipboard access can be refused (permissions, an insecure context).
      // The text is selectable either way, so this needs no error state --
      // just don't claim success that didn't happen.
    }
  }

  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-white/10 bg-black/60">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/40">
        <span className="uppercase tracking-wide">{lang || "text"}</span>
        {/* Hidden until the block is closed: half a command is worse than
            waiting for the rest of it. */}
        {!open && (
          <button
            type="button"
            onClick={copy}
            className="rounded px-1.5 py-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={copied ? "Copied" : "Copy to clipboard"}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[13px] leading-relaxed text-white/85">
        <code>{text.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

/** What the model did before answering, folded to one line until opened. */
function Trace({ lines }: { lines: TraceLine[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 text-xs text-white/45">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-white/5 hover:text-white/70"
      >
        <span aria-hidden className="inline-block w-3 text-center">
          {open ? "▾" : "▸"}
        </span>
        <span>{traceSummary(lines)}</span>
      </button>
      {open && (
        <ul className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
          {lines.map((l, i) => (
            <li key={i} className={`break-all ${l.failed ? "text-amber-300/70" : ""}`}>
              <span className="text-white/35">{l.verb} </span>
              {l.verb === "read" && safeHref(l.arg) ? (
                <a
                  href={l.arg}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-white/20 underline-offset-2 hover:text-white"
                >
                  {l.arg}
                </a>
              ) : (
                <code className="font-mono text-[11px] text-white/60">{l.arg}</code>
              )}
              {l.failed && <span className="text-white/35"> (nothing)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-5 mb-2 text-xl font-semibold text-white",
  2: "mt-5 mb-2 text-lg font-semibold text-white",
  3: "mt-4 mb-1.5 text-base font-semibold text-white",
  4: "mt-3 mb-1 text-[15px] font-semibold text-white",
  5: "mt-3 mb-1 text-sm font-semibold text-white",
  6: "mt-3 mb-1 text-sm font-semibold text-white/80",
};

function Inline({ tokens }: { tokens: Token[] | undefined }): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => <InlineToken key={i} token={t} />);
}

function InlineToken({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "strong":
      return (
        <strong className="font-semibold text-white">
          <Inline tokens={(token as Tokens.Strong).tokens} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inline tokens={(token as Tokens.Em).tokens} />
        </em>
      );
    case "del":
      return (
        <del className="text-white/50">
          <Inline tokens={(token as Tokens.Del).tokens} />
        </del>
      );
    case "codespan":
      return (
        <code className="break-all rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-white/90">
          {(token as Tokens.Codespan).text}
        </code>
      );
    case "br":
      return <br />;
    case "link": {
      const t = token as Tokens.Link;
      const href = safeHref(t.href);
      const inner = <Inline tokens={t.tokens} />;
      if (!href) return inner;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={t.title ?? undefined}
          className="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
        >
          {inner}
        </a>
      );
    }
    case "image": {
      // Never fetched: an image URL in a reply came from a page the model
      // read, and loading it would tell that page's owner the admin saw it.
      const t = token as Tokens.Image;
      return <span className="text-white/50">[image: {t.text || t.href}]</span>;
    }
    case "text": {
      const t = token as Tokens.Text;
      return t.tokens ? <Inline tokens={t.tokens} /> : t.text;
    }
    case "escape":
      return (token as Tokens.Escape).text;
    case "html":
      // Raw HTML stays raw: shown as the text it is.
      return (token as Tokens.HTML).text;
    default:
      return "raw" in token ? (token as { raw: string }).raw : null;
  }
}

function Blocks({ tokens }: { tokens: Token[] }): ReactNode {
  return tokens.map((t, i) => <BlockToken key={i} token={t} />);
}

function BlockToken({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const t = token as Tokens.Heading;
      const depth = Math.min(6, Math.max(1, t.depth));
      const Tag = `h${depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className={HEADING_CLASS[depth]}>
          <Inline tokens={t.tokens} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="my-2.5 first:mt-0 last:mb-0">
          <Inline tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      );
    case "text": {
      // A text block (a tight list item's body) carries inline tokens.
      const t = token as Tokens.Text;
      return t.tokens ? <Inline tokens={t.tokens} /> : t.text;
    }
    case "list": {
      const t = token as Tokens.List;
      const cls = "my-2.5 space-y-1 pl-6 marker:text-white/40";
      const items = t.items.map((item, i) => (
        <li key={i} className="pl-1">
          {item.task && (
            <input
              type="checkbox"
              checked={!!item.checked}
              readOnly
              className="mr-1.5 align-middle accent-netflix-red"
              aria-label={item.checked ? "Done" : "Not done"}
            />
          )}
          <Blocks tokens={item.tokens} />
        </li>
      ));
      return t.ordered ? (
        <ol start={typeof t.start === "number" ? t.start : undefined} className={`list-decimal ${cls}`}>
          {items}
        </ol>
      ) : (
        <ul className={`list-disc ${cls}`}>{items}</ul>
      );
    }
    case "blockquote":
      return (
        <blockquote className="my-2.5 border-l-2 border-white/20 pl-3 text-white/70">
          <Blocks tokens={(token as Tokens.Blockquote).tokens} />
        </blockquote>
      );
    case "code": {
      const t = token as Tokens.Code;
      return <CodeBlock text={t.text} lang={t.lang ?? ""} open={false} />;
    }
    case "hr":
      return <hr className="my-4 border-white/10" />;
    case "table": {
      const t = token as Tokens.Table;
      const align = (i: number) =>
        t.align[i] === "right" ? "text-right" : t.align[i] === "center" ? "text-center" : "text-left";
      return (
        <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full border-collapse text-[13px] leading-snug">
            <thead className="bg-white/[0.06] text-white">
              <tr>
                {t.header.map((c, i) => (
                  <th key={i} scope="col" className={`border-b border-white/10 px-3 py-2 font-semibold ${align(i)}`}>
                    <Inline tokens={c.tokens} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r} className="border-b border-white/5 last:border-0 even:bg-white/[0.02]">
                  {row.map((c, i) => (
                    <td key={i} className={`px-3 py-2 align-top text-white/85 ${align(i)}`}>
                      <Inline tokens={c.tokens} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "html":
      return <p className="my-2.5 whitespace-pre-wrap">{(token as Tokens.HTML).text}</p>;
    default:
      return "raw" in token ? <p className="my-2.5 whitespace-pre-wrap">{(token as { raw: string }).raw}</p> : null;
  }
}

/** Prose between code fences: activity lines apart, the rest as markdown. */
function Prose({ text }: { text: string }) {
  const chunks = useMemo(() => splitTrace(text), [text]);
  return (
    <>
      {chunks.map((c, i) =>
        c.kind === "trace" ? <Trace key={i} lines={c.lines} /> : <Blocks key={i} tokens={lexChat(c.text)} />
      )}
    </>
  );
}

/**
 * One chat turn.
 *
 * User turns stay plain text: they are the admin's own words, and finding a
 * fence in them would be a rendering surprise rather than a feature.
 */
export function ChatMessage({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") return <>{content}</>;
  return (
    <div className="chat-prose">
      {splitMessage(content).map((seg, i) =>
        seg.kind === "code" ? (
          <CodeBlock key={i} text={seg.text} lang={seg.lang} open={seg.open} />
        ) : (
          <Prose key={i} text={seg.text} />
        )
      )}
    </div>
  );
}
