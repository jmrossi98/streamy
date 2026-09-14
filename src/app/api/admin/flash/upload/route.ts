import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { slugFromFileName, titleFromFileName } from "@/lib/flashGameRules";
import { storeLocalFile } from "@/lib/flashStorage";
import { parseSwfMetadata } from "@/lib/swfMetadata";

/**
 * Accepts a SWF upload and adds it to the library.
 *
 * Admin-only: this writes files to the server's disk.
 *
 * The header is parsed before anything is stored, which does double duty --
 * it is how the player gets sized and how AS3 is flagged, and it is also the
 * only real check that the upload is a Flash movie at all. An extension and a
 * MIME type are both just claims made by the browser.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Comfortably past any real Flash game; the largest here is ~5MB. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const meta = parseSwfMetadata(bytes);
  if (!meta) {
    return NextResponse.json(
      { error: "That doesn’t look like a Flash movie." },
      { status: 400 }
    );
  }

  const title = titleFromFileName(file.name);
  let slug = slugFromFileName(file.name);
  for (let n = 2; await prisma.flashGame.findUnique({ where: { slug } }); n++) {
    slug = `${slugFromFileName(file.name)}-${n}`;
  }

  const stored = await storeLocalFile(`${slug}.swf`, bytes);
  if (!stored) return NextResponse.json({ error: "Couldn’t save the file" }, { status: 500 });

  await prisma.flashGame.create({
    data: {
      slug,
      title,
      fileName: stored,
      fileSize: bytes.length,
      storage: "local",
      width: meta.width,
      height: meta.height,
      frameRate: meta.frameRate,
      swfVersion: meta.swfVersion,
      isActionScript3: meta.isActionScript3,
    },
  });

  return NextResponse.json({ slug, title });
}
