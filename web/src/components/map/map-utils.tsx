import ReactDOMServer from "react-dom/server";
import UserAvatar from "@/components/UserAvatar";
import { cn } from "@/lib/utils";

export interface MarkerDotOptions {
  /** The box the dot is centered in; with a halo the tinted disc fills it. */
  size?: number;
  /** Dot diameter. Defaults to the box minus 4px, the bare dot's breathing room. */
  dot?: number;
  /** A translucent disc behind the dot marks the selected point without a heavier dot. */
  halo?: boolean;
}

/** HTML for the plain map dot. Pair with an Amap Pixel offset of (-size/2, -size/2) to center it. */
export function markerDotHTML(options?: MarkerDotOptions): { html: string; size: number } {
  const { size = 24, dot = size - 4, halo = false } = options || {};
  const html = ReactDOMServer.renderToString(
    <div
      aria-hidden="true"
      className={cn("grid place-items-center rounded-full", halo && "bg-primary/20")}
      style={{ width: size, height: size }}
    >
      <span
        className="rounded-full border-2 border-white shadow-[0_1px_4px_rgba(15,23,42,0.4)]"
        style={{ width: dot, height: dot, backgroundColor: "var(--primary)" }}
      />
    </div>,
  );
  return { html, size };
}

export const defaultMarkerDot = markerDotHTML();

const FACE_EDGE = "border-2 border-white shadow-[0_1px_4px_rgba(15,23,42,0.4)]";

export type MapFaceKind = { kind: "dot" } | { kind: "photo"; url: string } | { kind: "author"; avatarUrl?: string; name?: string };

/**
 * HTML for a photo or avatar pin: a rounded photo square or round avatar,
 * white-edged like the dot so it never blends into the basemap. Selection
 * grows it and adds the dot's translucent halo. A photo that fails to load
 * leaves the primary fill.
 */
export function faceIconHTML(face: Exclude<MapFaceKind, { kind: "dot" }>, selected: boolean): { html: string; size: number } {
  const box = selected ? 40 : 28;
  const side = selected ? 30 : 24;
  const html = ReactDOMServer.renderToString(
    <div
      aria-hidden="true"
      className={cn("grid place-items-center", selected && "bg-primary/20", face.kind === "photo" ? "rounded-[11px]" : "rounded-full")}
      style={{ width: box, height: box }}
    >
      {face.kind === "photo" ? (
        <span
          className={cn("block rounded-md bg-primary bg-cover bg-center", FACE_EDGE)}
          style={{ width: side, height: side, backgroundImage: `url(${JSON.stringify(face.url)})` }}
        />
      ) : (
        <UserAvatar className={cn(FACE_EDGE, selected ? "size-[30px]" : "size-6")} avatarUrl={face.avatarUrl} name={face.name} />
      )}
    </div>,
  );
  return { html, size: box };
}

export const faceKey = (face: MapFaceKind): string =>
  face.kind === "photo" ? `photo:${face.url}` : face.kind === "author" ? `author:${face.avatarUrl ?? ""}:${face.name ?? ""}` : "dot";
