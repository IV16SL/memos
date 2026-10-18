import { describe, expect, it } from "vitest";
import { faceIconHTML, markerDotHTML } from "@/components/map/map-utils";

describe("markerDotHTML", () => {
  it("uses a compact location dot instead of an arrow-shaped pin", () => {
    const { html, size } = markerDotHTML();

    expect(html).not.toContain("<svg");
    expect(html).toContain("rounded-full");
    expect(size).toBe(24);
  });

  it("adds a translucent halo for the selected state", () => {
    expect(markerDotHTML({ halo: true }).html).toContain("bg-primary/20");
    expect(markerDotHTML().html).not.toContain("bg-primary/20");
  });
});

describe("faceIconHTML", () => {
  it("renders a photo square", () => {
    const { html, size } = faceIconHTML({ kind: "photo", url: "/thumb.jpg" }, false);

    expect(html).toContain("/thumb.jpg");
    expect(size).toBe(28);
  });

  it("renders an author avatar", () => {
    const { html } = faceIconHTML({ kind: "author", avatarUrl: "/bob.png", name: "Bob" }, false);

    expect(html).toContain("/bob.png");
  });

  it("grows a selected face pin and adds the halo", () => {
    const face = { kind: "author" as const, avatarUrl: "/bob.png", name: "Bob" };

    expect(faceIconHTML(face, false).size).toBe(28);
    const selected = faceIconHTML(face, true);
    expect(selected.size).toBe(40);
    expect(selected.html).toContain("bg-primary/20");
  });
});
