import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SymbolPicker from "@/components/SymbolPicker.vue";

describe("SymbolPicker", () => {
  it("emits the symbol that was clicked", () => {
    const wrapper = mount(SymbolPicker, {
      props: {
        groups: [
          {
            name: "Arrows",
            symbols: [
              { char: "➤", name: "Black rightwards arrowhead" },
              { char: "➣", name: "Three-D bottom-lighted rightwards arrowhead" },
            ],
          },
        ],
      },
      attachTo: document.body,
    });
    // The menu is appended to the body, outside the wrapper.
    const symbols = [...document.querySelectorAll<HTMLButtonElement>("button.symbol")];
    expect(symbols.map((b) => b.textContent?.trim())).toEqual(["➤", "➣"]);

    expect(symbols[1].title).toBe("Three-D bottom-lighted rightwards arrowhead");

    symbols[1].click();

    expect(wrapper.emitted("pick")).toEqual([["➣"]]);
    wrapper.unmount();
  });
});
