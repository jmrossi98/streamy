/**
 * Which slot the admin chat answers on (chatModels.ts): one Setting row,
 * picked in Model routing since 2026-10-25. Before that it was a button row
 * in the chat header, remembered per chat, which put the "which model"
 * question in two places that disagreed.
 */
import { prisma } from "./db";
import { DEFAULT_BACKEND, isChatBackendId, type ChatBackendId } from "./chatModels";
import { routingSnapshot } from "./llm";
import { isOllamaConfigured, ollamaModel } from "./ollama";

export const CHAT_BACKEND_KEY = "chat_backend";

/** Fails soft to the default: a broken row must not stop the chat. */
export async function getChatBackend(): Promise<ChatBackendId> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: CHAT_BACKEND_KEY }, select: { value: true } });
    return row && isChatBackendId(row.value) ? row.value : DEFAULT_BACKEND;
  } catch {
    return DEFAULT_BACKEND;
  }
}

export async function saveChatBackend(id: ChatBackendId): Promise<ChatBackendId> {
  await prisma.setting.upsert({
    where: { key: CHAT_BACKEND_KEY },
    create: { key: CHAT_BACKEND_KEY, value: id },
    update: { value: id },
  });
  return id;
}

/** What the chat's local slot is, for the panel (it has no routing row). */
export function localSlotInfo() {
  return { available: isOllamaConfigured(), model: ollamaModel() };
}

/** The routing snapshot plus the chat's choice: everything Model routing shows. */
export async function modelsSnapshot() {
  const [routing, backend] = await Promise.all([routingSnapshot(), getChatBackend()]);
  return { ...routing, chat: { backend, local: localSlotInfo() } };
}
