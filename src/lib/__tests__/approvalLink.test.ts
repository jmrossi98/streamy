import { describe, expect, it } from "vitest";
import { APPROVAL_LINK_TTL_MS, approvalLinkUrl, makeApprovalToken, readApprovalToken } from "@/lib/approvalLink";

const SECRET = "s3cret";
const NOW = 1_800_000_000_000;

describe("approval links", () => {
  it("round-trips the account id", () => {
    expect(readApprovalToken(makeApprovalToken("cuid123", SECRET, NOW), SECRET, NOW)).toBe("cuid123");
  });

  it("expires", () => {
    const t = makeApprovalToken("cuid123", SECRET, NOW);
    expect(readApprovalToken(t, SECRET, NOW + APPROVAL_LINK_TTL_MS + 1)).toBeNull();
  });

  it("rejects another account's id under the same signature", () => {
    const [, exp, mac] = makeApprovalToken("cuid123", SECRET, NOW).split(".");
    expect(readApprovalToken(`other.${exp}.${mac}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a different secret and junk", () => {
    expect(readApprovalToken(makeApprovalToken("cuid123", SECRET, NOW), "other", NOW)).toBeNull();
    expect(readApprovalToken("nope", SECRET, NOW)).toBeNull();
    expect(readApprovalToken("a.b.c", "", NOW)).toBeNull();
  });

  it("builds the link", () => {
    expect(approvalLinkUrl("https://streamy-app.com/", "a.1.x")).toBe("https://streamy-app.com/api/approvals/accept?token=a.1.x");
  });
});
