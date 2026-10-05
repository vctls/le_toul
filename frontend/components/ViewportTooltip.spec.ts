const sources = import.meta.glob<string>("/frontend/**/*.vue", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("tooltips", () => {
  // A bare b-tooltip renders inside its container, so a drawer or a scrolling column crops it.
  it("all go through ViewportTooltip", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith("/ViewportTooltip.vue"))
      .filter(([, source]) => /<(b-tooltip|BTooltip)\b/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
