import { default as BuefyColor } from "buefy/src/utils/color";

// Bulma's theme colors are hsl() expressions built out of further custom properties, and
// an ASS style row needs literal channels. Only the browser can reduce one, so a throwaway
// element is styled with the expression and its computed color read back.
export function resolveThemeColor(cssValue: string, fallback: string): BuefyColor {
  try {
    const probe = document.createElement("div");
    probe.style.display = "none";
    probe.style.color = cssValue;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return BuefyColor.parse(computed);
  } catch {
    return BuefyColor.parse(fallback);
  }
}
