#!/usr/bin/env node
/**
 * The Claude Code end of the chat bridge, run inside the app container:
 *
 *   ssh streamy 'docker exec -i streamy-app-app-1 node /app/chat-bridge.cjs' < request.json
 *
 * Reads one JSON request on stdin, makes sure the bridge token exists (it is
 * created here, in the database, on first use -- it never leaves the box),
 * calls the app's own /api/chat-bridge on localhost, and prints the JSON
 * answer. Exit status 1 on any failure, with the reason on stderr.
 */
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const KEY = "chat_bridge_token";

async function token(prisma) {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (row && row.value) return row.value;
  const value = crypto.randomBytes(32).toString("hex");
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: {} });
  return (await prisma.setting.findUnique({ where: { key: KEY } })).value;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const prisma = new PrismaClient();
  let bearer;
  try {
    bearer = await token(prisma);
  } finally {
    await prisma.$disconnect();
  }
  const port = process.env.PORT || 3000;
  const res = await fetch(`http://127.0.0.1:${port}/api/chat-bridge`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: input || "{}",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  process.stdout.write(text);
  if (!res.ok) {
    process.stderr.write(`chat bridge: HTTP ${res.status}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`chat bridge: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
