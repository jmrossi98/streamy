import { describe, it, expect } from "vitest";
import {
  applySave, diffStorage, hasChanges, mergeSave, snapshotStorage,
} from "../flashSaves";

/** Minimal Storage stand-in -- the real one isn't available under node. */
function fakeStorage(initial: Record<string, string> = {}, opts: { failOn?: string } = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failOn === k) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  } as Storage;
}

describe("snapshotStorage", () => {
  it("captures every entry", () => {
    expect(snapshotStorage(fakeStorage({ a: "1", b: "2" }))).toEqual({ a: "1", b: "2" });
  });

  it("returns an empty object for an empty store", () => {
    expect(snapshotStorage(fakeStorage())).toEqual({});
  });
});

describe("diffStorage", () => {
  // Ruffle's localStorage key format isn't a documented contract, so nothing
  // here reads known key names -- it diffs before against after, which
  // survives Ruffle changing its scheme.
  it("reports keys the game added", () => {
    expect(diffStorage({ other: "x" }, { other: "x", "ruffle-save": "abc" }))
      .toEqual({ "ruffle-save": "abc" });
  });

  it("reports keys the game changed", () => {
    expect(diffStorage({ save: "old" }, { save: "new" })).toEqual({ save: "new" });
  });

  it("ignores untouched keys, so a save carries only this game's data", () => {
    expect(diffStorage({ theme: "dark", save: "s" }, { theme: "dark", save: "s" })).toEqual({});
  });

  // A key present before and absent after is NOT a deletion to report.
  // Ruffle doesn't remove another game's data, so a vanished key means
  // something else cleared it -- and treating that as "the save is gone" would
  // push an empty result over a real save.
  it("does not report a removal as a change", () => {
    expect(diffStorage({ save: "s" }, {})).toEqual({});
  });
});

describe("mergeSave", () => {
  // The case this exists for is a device that's behind, not one that's ahead.
  it("lets the server copy win", () => {
    expect(mergeSave({ save: "local" }, { save: "server" })).toEqual({ save: "server" });
  });

  it("keeps local keys the server doesn't know about", () => {
    expect(mergeSave({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" });
  });
});

describe("hasChanges", () => {
  it("is false for an empty diff, so no request is made", () => {
    expect(hasChanges({})).toBe(false);
    expect(hasChanges({ a: "1" })).toBe(true);
  });
});

describe("applySave", () => {
  it("writes every entry and reports the count", () => {
    const s = fakeStorage();
    expect(applySave(s, { a: "1", b: "2" })).toBe(2);
    expect(s.getItem("a")).toBe("1");
  });

  // One oversized value, or a quota refusal on a nearly-full store, must cost
  // that entry rather than the whole save.
  it("keeps going when one key can't be written", () => {
    const s = fakeStorage({}, { failOn: "big" });
    expect(applySave(s, { a: "1", big: "x", b: "2" })).toBe(2);
    expect(s.getItem("a")).toBe("1");
    expect(s.getItem("b")).toBe("2");
    expect(s.getItem("big")).toBeNull();
  });

  it("overwrites an existing local value", () => {
    const s = fakeStorage({ save: "old" });
    applySave(s, { save: "new" });
    expect(s.getItem("save")).toBe("new");
  });
});

describe("the round trip", () => {
  // End to end: a fresh device restores a server save, plays, and sends back
  // only what actually changed.
  it("restores, then reports only new progress", () => {
    const device = fakeStorage({ "streamy-theme": "dark" });
    applySave(device, { "ruffle-save": "level-3" });
    const baseline = snapshotStorage(device);

    device.setItem("ruffle-save", "level-7");
    const changed = diffStorage(baseline, snapshotStorage(device));

    expect(changed).toEqual({ "ruffle-save": "level-7" });
    expect(changed["streamy-theme"]).toBeUndefined();
  });

  it("sends nothing when the game was opened but never saved", () => {
    const device = fakeStorage({ "ruffle-save": "level-3" });
    const baseline = snapshotStorage(device);
    expect(hasChanges(diffStorage(baseline, snapshotStorage(device)))).toBe(false);
  });
});
