import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The web app manifest lets a phone add Cadence to its Home Screen, which
// iPhone needs before it allows browser push.

type Manifest = {
  name?: string;
  display?: string;
  start_url?: string;
  icons?: { src: string; sizes: string; type: string }[];
};

const manifest: Manifest = JSON.parse(
  readFileSync("public/manifest.webmanifest", "utf8")
);

function publicFile(src: string) {
  return path.join("public", src.replace(/^\//, ""));
}

describe("the web app manifest", () => {
  it("opens Cadence at the home page as a standalone app", () => {
    expect(manifest.name).toBe("Cadence");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  it.each(["192x192", "512x512"])("has a %s PNG icon that exists", (sizes) => {
    const icon = manifest.icons?.find((i) => i.sizes === sizes);

    expect(icon?.type).toBe("image/png");
    expect(icon && existsSync(publicFile(icon.src))).toBe(true);
  });

  it("is linked from every page, with an apple-touch-icon", () => {
    const root = readFileSync("app/root.tsx", "utf8");

    expect(root).toContain('href: "/manifest.webmanifest"');
    expect(root).toContain('rel: "apple-touch-icon"');
    expect(existsSync("public/icons/apple-touch-icon.png")).toBe(true);
  });

  it("has the 96 px badge the push channel shows", () => {
    expect(existsSync("public/icons/badge-96.png")).toBe(true);
  });
});
