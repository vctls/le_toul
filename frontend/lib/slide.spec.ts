import { describe, expect, test } from "vitest";
import { slide } from "./slide";

// jsdom runs no CSS transitions, so these cover the path that finishes at once.
describe("slide", () => {
  test("hides a shut element and hands an open one's height back to its content", () => {
    const el = document.createElement("div");
    document.body.append(el);

    slide(el, false);
    expect(el.style.display).toBe("none");

    slide(el, true);
    expect(el.style.display).toBe("");
    expect(el.style.height).toBe("");
    expect(el.style.overflow).toBe("");
  });
});
