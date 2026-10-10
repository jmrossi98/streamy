/**
 * Which key presses the player answers. Pure.
 *
 * Space is play/pause everywhere a video plays, but the same key also types a
 * space, ticks a checkbox and presses whatever button has focus, so the
 * question is always where the press landed.
 */

/** The parts of a key press and its target the decision depends on. */
export type KeyPress = {
  key: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Lower- or upper-case tag of the element the press landed on, if any. */
  targetTag?: string | null;
  /** `type` of the target when it is an input. */
  targetType?: string | null;
  targetEditable?: boolean;
  /** Whether the target sits inside the player itself. */
  targetInPlayer?: boolean;
};

/** Controls that take a press of space for themselves. */
const PRESSABLE = new Set(["button", "a", "summary"]);

export function spaceTogglesPlayback(press: KeyPress): boolean {
  if (press.key !== " " && press.key !== "Spacebar") return false;
  // Held down, the key repeats; one press is one toggle.
  if (press.repeat || press.ctrlKey || press.metaKey || press.altKey) return false;

  const tag = (press.targetTag ?? "").toLowerCase();
  if (press.targetEditable || tag === "textarea" || tag === "select") return false;
  // A slider does nothing with space; every other input types or ticks with it.
  if (tag === "input") return press.targetType === "range" && !!press.targetInPlayer;
  // Inside the player a focused control is usually just the last thing
  // clicked (mute, fullscreen), and space should still mean play/pause.
  // Outside it, on a page that has more than the player, a button keeps its key.
  if (PRESSABLE.has(tag)) return !!press.targetInPlayer;
  return true;
}
