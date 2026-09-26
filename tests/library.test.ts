import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, defaultAspectFor, entryFor, titleFor } from "../scripts/build-library";

describe("defaultAspectFor", () => {
  it.each(["autumn-tree", "dachshund-in-hat", "lighthouse", "concert-singer"])(
    "%s is portrait 3:4",
    (slug) => expect(defaultAspectFor(slug)).toBe("3:4"),
  );
  it.each(["cartoon-dachshunds", "cheshire-cat", "orange-sunset"])("%s is landscape 4:3", (slug) =>
    expect(defaultAspectFor(slug)).toBe("4:3"),
  );
  it.each([
    "pixel-beach",
    "pixel-sheep-rider",
    "sheep-in-space",
    "leaping-bunnies",
    "emotional-support-hotdog",
    "unknown-thing",
  ])("%s is square 1:1", (slug) => expect(defaultAspectFor(slug)).toBe("1:1"));
});

describe("titleFor", () => {
  it("title-cases words and keeps minor words lowercase", () => {
    expect(titleFor("dachshund-in-hat")).toBe("Dachshund in Hat");
    expect(titleFor("sheep-in-space")).toBe("Sheep in Space");
    expect(titleFor("emotional-support-hotdog")).toBe("Emotional Support Hotdog");
    expect(titleFor("lighthouse")).toBe("Lighthouse");
  });
  it("capitalizes a leading minor word", () => {
    expect(titleFor("the-end")).toBe("The End");
  });
});

describe("manifest", () => {
  it("entry paths are relative with no leading slash", () => {
    expect(entryFor("lighthouse")).toEqual({
      slug: "lighthouse",
      title: "Lighthouse",
      aspect: "3:4",
      src: "library/lighthouse.webp",
      thumb: "library/lighthouse-thumb.webp",
    });
  });

  it("keeps only jpg files and sorts by slug", () => {
    const m = buildManifest(["b.jpg", "notes.txt", "a.JPEG", "c.png"]);
    expect(m.map((e) => e.slug)).toEqual(["a", "b"]);
  });

  it("covers all 12 bundled images", () => {
    const dir = join(import.meta.dirname, "..", "images");
    if (!existsSync(dir)) return;
    const m = buildManifest(readdirSync(dir));
    expect(m).toHaveLength(12);
    const counts = { "1:1": 0, "3:4": 0, "4:3": 0 };
    for (const e of m) counts[e.aspect]++;
    expect(counts).toEqual({ "1:1": 5, "3:4": 4, "4:3": 3 });
  });
});
