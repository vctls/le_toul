import { describe, expect, it } from "vitest";
import { renderCustomIntro } from "@/lib/customIntro";

describe("renderCustomIntro", () => {
  it("leaves the built-in intro when there is no Markdown", () => {
    expect(renderCustomIntro("")).toBeNull();
    expect(renderCustomIntro("  \n")).toBeNull();
  });

  it("replaces the built-in intro without a placeholder", () => {
    expect(renderCustomIntro("**Beta.** Expect bugs.")).toEqual({
      before: "<p><strong>Beta.</strong> Expect bugs.</p>\n",
      after: "",
      showBuiltIn: false,
    });
  });

  it("places the built-in intro at a line holding only the placeholder", () => {
    expect(renderCustomIntro("Above\n\n {intro} \n\nBelow\n")).toEqual({
      before: "<p>Above</p>\n",
      after: "<p>Below</p>\n",
      showBuiltIn: true,
    });
  });

  it("keeps a placeholder inside a line as text", () => {
    const custom = renderCustomIntro("Type {intro} here");

    expect(custom?.showBuiltIn).toBe(false);
    expect(custom?.before).toContain("{intro}");
  });

  it("passes raw HTML through", () => {
    expect(renderCustomIntro('<p class="notice">Hi</p>')?.before).toBe('<p class="notice">Hi</p>');
  });
});
