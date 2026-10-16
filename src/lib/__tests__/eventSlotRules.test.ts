import { describe, it, expect } from "vitest";
import { eventSlotLabel, eventSlotStart, eventSlotStartsAt, eventSlotState } from "../eventSlotRules";

// 2026-10-16 is in daylight time: Eastern is UTC-4, so 8pm ET is 00:00 UTC next day.
const at = (iso: string) => Date.parse(iso);

describe("eventSlotStart", () => {
  it("reads the clock time out of a slot name", () => {
    expect(eventSlotStart("NHL | 08 - 8pm Sharks at Predators")).toEqual({ hour: 20, minute: 0 });
    expect(eventSlotStart("NFL | 03 - 1pm Patriots at Bills")).toEqual({ hour: 13, minute: 0 });
    expect(eventSlotStart("NBA | 12 - 10:30pm Lakers at Warriors")).toEqual({ hour: 22, minute: 30 });
    expect(eventSlotStart("MLB | 01 - 12pm Yankees at Red Sox")).toEqual({ hour: 12, minute: 0 });
  });
  it("leaves ordinary channels alone", () => {
    expect(eventSlotStart("US| NHL NETWORK")).toBeNull();
    expect(eventSlotStart("USA - FOX 29 BUFFALO NY (WUTV)")).toBeNull();
    expect(eventSlotStart("NHL TEAM| SAN JOSE SHARKS")).toBeNull();
  });
});

describe("eventSlotState", () => {
  const name = "NHL | 08 - 8pm Sharks at Predators";
  it("places the slot on today's date in Eastern time", () => {
    expect(eventSlotStartsAt(name, at("2026-10-16T18:00:00Z"))).toBe(at("2026-10-17T00:00:00Z"));
    // After midnight UTC it is still the 16th in Eastern, so the same 8pm.
    expect(eventSlotStartsAt(name, at("2026-10-17T02:00:00Z"))).toBe(at("2026-10-17T00:00:00Z"));
  });
  it("is upcoming until half an hour before, live through the game, then over", () => {
    expect(eventSlotState(name, at("2026-10-16T18:00:00Z"))).toBe("upcoming");
    expect(eventSlotState(name, at("2026-10-16T23:31:00Z"))).toBe("live");
    expect(eventSlotState(name, at("2026-10-17T02:30:00Z"))).toBe("live");
    // A 1pm game at 11pm Eastern the same day.
    expect(eventSlotState("NFL | 03 - 1pm Patriots at Bills", at("2026-10-17T03:00:00Z"))).toBe("over");
  });
  it("keeps a late game live past Eastern midnight, then counts it as tomorrow's slot", () => {
    const late = "NBA | 12 - 10:30pm Lakers at Warriors";
    expect(eventSlotState(late, at("2026-10-17T05:00:00Z"))).toBe("live"); // 1am ET, second half
    expect(eventSlotState(late, at("2026-10-17T07:00:00Z"))).toBe("upcoming"); // 3am ET
    expect(eventSlotState(name, at("2026-10-17T04:01:00Z"))).toBe("upcoming"); // 12:01am ET, 8pm slot
  });
  it("uses standard time in winter", () => {
    // 2026-12-01: Eastern is UTC-5, so 8pm ET is 01:00 UTC.
    expect(eventSlotStartsAt(name, at("2026-12-01T18:00:00Z"))).toBe(at("2026-12-02T01:00:00Z"));
  });
  it("says nothing about a non-slot", () => {
    expect(eventSlotState("US| NHL NETWORK", at("2026-10-16T18:00:00Z"))).toBeNull();
    expect(eventSlotLabel("US| NHL NETWORK", at("2026-10-16T18:00:00Z"))).toBeNull();
  });
});

describe("eventSlotLabel", () => {
  it("names the start time or says the game is over", () => {
    expect(eventSlotLabel("NHL | 08 - 8pm Sharks at Predators", at("2026-10-16T18:00:00Z"))).toBe("Starts 8pm ET");
    expect(eventSlotLabel("NBA | 12 - 10:30pm Lakers at Warriors", at("2026-10-16T18:00:00Z"))).toBe("Starts 10:30pm ET");
    expect(eventSlotLabel("NFL | 03 - 1pm Patriots at Bills", at("2026-10-16T23:00:00Z"))).toBe("Game over - slot is idle");
    expect(eventSlotLabel("NFL | 03 - 1pm Patriots at Bills", at("2026-10-16T17:30:00Z"))).toBeNull();
  });
});
