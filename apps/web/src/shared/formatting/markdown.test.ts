import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "./markdown";

describe("renderSafeMarkdown", () => {
  it("removes scripts and unsafe URLs", () => {
    const html = renderSafeMarkdown(
      "[safe](https://example.com) [bad](javascript:alert(1)) <script>alert(2)</script>",
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not allow model-generated styles or event handlers", () => {
    const html = renderSafeMarkdown(
      '<p style="color:red" onclick="alert(1)">Text</p>',
    );
    expect(html).toBe("<p>Text</p>");
  });
});
