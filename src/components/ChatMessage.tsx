"use client";

import { useEffect, useState } from "react";
import { splitMessage, copyableText } from "@/lib/chatSegments";

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
    <div className="group/code relative my-2">
      <pre className="overflow-x-auto rounded bg-black/50 px-3 py-2 pr-16 text-xs leading-relaxed text-white/85 ring-1 ring-white/10">
        <code>{text.replace(/\n$/, "")}</code>
      </pre>
      {lang && (
        <span className="pointer-events-none absolute left-2 top-full -mt-0.5 text-[10px] uppercase tracking-wide text-white/25">
          {lang}
        </span>
      )}
      {/* Hidden until the block is closed: half a command is worse than
          waiting for the rest of it. */}
      {!open && (
        <button
          type="button"
          onClick={copy}
          className="absolute right-1.5 top-1.5 rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-white/70 opacity-0 transition-opacity hover:bg-white/25 hover:text-white focus-visible:opacity-100 group-hover/code:opacity-100"
          aria-label={copied ? "Copied" : "Copy to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

/**
 * One chat turn.
 *
 * User turns stay plain text: they are the admin's own words, and finding a
 * fence in them would be a rendering surprise rather than a feature.
 */
export function ChatMessage({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  if (role === "user" || !content.includes("```")) {
    return <>{content}</>;
  }

  return (
    <>
      {splitMessage(content).map((seg, i) =>
        seg.kind === "code" ? (
          <CodeBlock key={i} text={seg.text} lang={seg.lang} open={seg.open} />
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
