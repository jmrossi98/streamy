"use client";

import { useState } from "react";
import { Button } from "./index";

/**
 * A value someone has to type somewhere else -- a server address, a key --
 * shown in full with a Copy button. `secret` hides it on screen but still
 * copies it.
 */
export function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-white/50">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1 text-white/85">{secret ? "•".repeat(16) : value}</code>
      <Button
        size="xs"
        variant="secondary"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard refused; the value is on screen to copy by hand.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
