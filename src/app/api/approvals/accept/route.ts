import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/auditLog";
import { readApprovalToken } from "@/lib/approvalLink";

/**
 * The link in the "new account waiting" email.
 *
 * Opening it (GET) only shows a page; that page submits the approval itself
 * as it loads. Mail security scanners open every link in a message to check
 * it, and an approval made on GET would let one approve accounts on its own.
 * They don't run the page's script; the person clicking does, so for them it
 * is still one click. The button is the fallback without JavaScript.
 *
 * No session needed: the signed token is the authority (see approvalLink.ts).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#141414;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{max-width:420px;text-align:center}button{font:inherit;padding:10px 20px;border-radius:6px;border:0;background:#e50914;color:#fff;cursor:pointer}
a{color:#fff}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!readApprovalToken(token, process.env.NEXTAUTH_SECRET ?? "")) {
    return page("Link expired", "<h1>This link has expired</h1><p>Approve the account from <a href=\"/admin/approvals\">Approvals</a> instead.</p>", 410);
  }
  return page(
    "Approving…",
    `<h1>Approving…</h1><form id="f" method="post"><input type="hidden" name="token" value="${escape(token)}">
<button type="submit">Approve account</button></form><script>document.getElementById("f").submit()</script>`
  );
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const userId = readApprovalToken(token, process.env.NEXTAUTH_SECRET ?? "");
  if (!userId) {
    return page("Link expired", "<h1>This link has expired</h1><p>Approve the account from <a href=\"/admin/approvals\">Approvals</a> instead.</p>", 410);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, approved: true } });
  if (!user) {
    return page("Not found", "<h1>That account no longer exists</h1><p>It was probably denied already.</p>", 404);
  }
  if (user.approved) {
    return page("Already approved", `<h1>${escape(user.name)} is already approved</h1><p><a href="/">Open Streamy</a></p>`);
  }
  await prisma.user.updateMany({ where: { id: userId, approved: false }, data: { approved: true } });
  await logAudit("email link", "approval.approve", user.name);
  return page("Approved", `<h1>Approved ${escape(user.name)}</h1><p>They can sign in now.</p><p><a href="/admin/approvals">Approvals</a></p>`);
}
