/**
 * The saved skill-engine choice (see skillEngineRules.ts): one JSON Setting
 * row, defaults underneath, so moving mediabox runs from Claude Code to
 * OpenCode (or changing the model) is a form edit, not a deploy.
 */
import { prisma } from "./db";
import { DEFAULT_SKILL_ENGINE, normalizeSkillEngine, type SkillEngineChoice } from "./skillEngineRules";

export const SKILL_ENGINE_KEY = "skill_engine";

/** Fails soft to the defaults: a broken row must not stop runs. */
export async function getSkillEngine(): Promise<SkillEngineChoice> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SKILL_ENGINE_KEY }, select: { value: true } });
    return row ? normalizeSkillEngine(JSON.parse(row.value)) : DEFAULT_SKILL_ENGINE;
  } catch {
    return DEFAULT_SKILL_ENGINE;
  }
}

/** Validates and stores a choice; returns what was actually saved. */
export async function saveSkillEngine(raw: unknown): Promise<SkillEngineChoice> {
  const clean = normalizeSkillEngine(raw);
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: SKILL_ENGINE_KEY },
    create: { key: SKILL_ENGINE_KEY, value },
    update: { value },
  });
  return clean;
}
