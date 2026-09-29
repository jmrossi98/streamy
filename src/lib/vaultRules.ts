/**
 * Pure helpers for reading the Obsidian vault over WebDAV -- parsing a
 * PROPFIND listing and deciding which paths may be read. The fetching lives in
 * vault.ts.
 */

export type VaultEntry = { path: string; isDir: boolean; modified: string | null };

/**
 * Entries from one PROPFIND (Depth: 1) multistatus body, excluding the folder
 * itself. Paths are decoded and relative to the vault root, without a leading
 * slash; folders end in "/".
 */
export function parsePropfind(xml: string, requestedDir: string): VaultEntry[] {
  const self = normalizeDir(requestedDir);
  const entries: VaultEntry[] = [];
  for (const block of xml.split(/<D:response\b/i).slice(1)) {
    const href = /<D:href>([^<]*)<\/D:href>/i.exec(block)?.[1];
    if (!href) continue;
    let path: string;
    try {
      path = decodeURIComponent(href).replace(/^\/+/, "");
    } catch {
      continue;
    }
    const isDir = /<D:collection\s*\/>/i.test(block);
    if (isDir && !path.endsWith("/") && path !== "") path += "/";
    if (path === self) continue;
    const modified = /<lp1:getlastmodified>([^<]*)</i.exec(block)?.[1] ?? null;
    entries.push({ path, isDir, modified });
  }
  return entries;
}

function normalizeDir(dir: string): string {
  const d = dir.replace(/^\/+/, "");
  return d === "" || d.endsWith("/") ? d : `${d}/`;
}

/** Folders never read: Obsidian's own config, trash, and hidden folders. */
export function isHiddenVaultPath(path: string): boolean {
  return path.split("/").some((part) => part.startsWith(".") && part.length > 1);
}

/**
 * Whether a path may be read at all: relative, inside the vault, no traversal,
 * not hidden, and a note (Markdown). The vault may hold other files -- images,
 * PDFs -- and nothing here needs them.
 */
export function isReadableNote(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  if (path.split("/").some((p) => p === ".." || p === ".")) return false;
  if (isHiddenVaultPath(path)) return false;
  return /\.md$/i.test(path);
}

/** URL-encodes each segment, keeping the slashes. */
export function encodeVaultPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
