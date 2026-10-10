import { describe, it, expect } from "vitest";
import { spaceTogglesPlayback } from "../playerKeyRules";

describe("space as play/pause", () => {
  it("toggles when nothing in particular has focus", () => {
    expect(spaceTogglesPlayback({ key: " ", targetTag: "BODY" })).toBe(true);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "VIDEO", targetInPlayer: true })).toBe(true);
    expect(spaceTogglesPlayback({ key: " " })).toBe(true);
  });

  it("ignores every other key", () => {
    expect(spaceTogglesPlayback({ key: "k", targetTag: "BODY" })).toBe(false);
    expect(spaceTogglesPlayback({ key: "Enter", targetTag: "BODY" })).toBe(false);
  });

  it("ignores a held key and shortcuts", () => {
    expect(spaceTogglesPlayback({ key: " ", repeat: true })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", ctrlKey: true })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", metaKey: true })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", altKey: true })).toBe(false);
  });

  it("leaves typing alone", () => {
    expect(spaceTogglesPlayback({ key: " ", targetTag: "INPUT", targetType: "text" })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "INPUT", targetType: "search", targetInPlayer: true })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "TEXTAREA" })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "SELECT" })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "DIV", targetEditable: true })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "INPUT", targetType: "checkbox" })).toBe(false);
  });

  it("takes over the player's own controls", () => {
    expect(spaceTogglesPlayback({ key: " ", targetTag: "BUTTON", targetInPlayer: true })).toBe(true);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "INPUT", targetType: "range", targetInPlayer: true })).toBe(true);
  });

  it("leaves controls elsewhere on the page their key", () => {
    expect(spaceTogglesPlayback({ key: " ", targetTag: "BUTTON" })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "A" })).toBe(false);
    expect(spaceTogglesPlayback({ key: " ", targetTag: "INPUT", targetType: "range" })).toBe(false);
  });
});
