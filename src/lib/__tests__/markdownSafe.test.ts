import { describe, expect, it } from "vitest";
import { renderMarkdownSafe } from "../markdownSafe";

describe("renderMarkdownSafe", () => {
  it("renders Markdown", () => {
    expect(renderMarkdownSafe("# Jake\n\n- Built **X**")).toContain("<strong>X</strong>");
  });
  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdownSafe('Hi <script>alert(1)</script> <img src=x onerror="alert(2)">');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("neutralises javascript: links", () => {
    expect(renderMarkdownSafe("[x](javascript:alert(1))")).not.toContain("javascript:");
  });
});
