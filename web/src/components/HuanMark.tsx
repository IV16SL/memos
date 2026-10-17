import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

// The "huan" (幻) glyph extracted from the finalized huan-icon (logo.svg).
// The glyph group carries its own 45.23° rotation; kept verbatim so the mark
// renders exactly like the previous full-logo.webp raster.
const GLYPH_TRANSFORM = "rotate(45.226077 512 512)";
const GLYPH_PATH =
  "m 394.05787,306.23048 c 0.44949,56.95671 0.66177,83.85605 1.11297,141.0307 0.42876,54.32966 -5.28897,137.94179 28.09875,139.44137 54.57649,-1.36701 17.44127,-125.13218 39.89003,-187.644 29.88557,-62.80477 106.09554,-71.9338 145.47206,-42.72317 40.76222,32.79686 48.65611,68.7904 48.95129,106.1938 0.18397,76.38349 1.19276,151.14143 1.81172,229.57239 0.62742,79.50256 -8.3129,145.68411 27.66333,146.86627 50.99873,-0.17115 35.85136,-80.02448 35.94869,-123.7421 0.12707,-18.50171 1.5097,-52.76107 4.52198,-66.65221 5.02538,-17.24955 11.02558,-30.44534 20.60383,-40.88661 20.96658,-25.99076 36.88677,-25.4972 55.38849,-27.66841 33.72921,-1.6141 84.15515,27.87017 111.0262,47.64281 39.59567,33.3313 23.82546,60.21144 4.9823,69.82226 -39.38568,20.36957 -86.0894,-56.31014 -110.51019,-33.97214 -24.10411,22.76645 -7.48131,22.68107 -6.88481,140.43939 1.71796,93.77408 -94.91336,134.24628 -140.8942,122.01747 -33.98921,-8.23876 -56.7168,-31.71582 -71.43551,-79.56905 -13.17018,-42.81865 -8.22324,-89.33313 -8.57147,-133.45811 -0.40637,-51.49405 -1.48955,-146.5799 -1.4072,-178.31333 -0.22175,-28.0986 -0.36284,-45.97793 -0.63467,-80.42247 -0.25939,-32.86706 -39.90898,-29.39382 -48.63439,-9.0867 -11.7442,29.68256 -5.52623,82.3999 -7.56415,126.91581 -2.03793,44.5159 -12.95864,86.66758 -72.8188,101.7317 -98.45996,17.56243 -134.50461,-83.72968 -135.41442,-199.01635 -0.51602,-65.38857 -1.22466,-155.18055 -1.68181,-213.10952 -0.25832,-32.73287 -49.54942,-74.24637 -67.20577,35.3159 -5.95389,50.11277 -59.33051,37.67184 -71.72784,10.34963 -10.90173,-21.44628 4.51619,-136.79087 81.21459,-155.21349 98.01715,-23.5433 137.68674,70.34057 138.699,154.13816 z";

type HuanMarkProps = SVGProps<SVGSVGElement> & {
  size?: number;
  label?: string;
};

/**
 * Brand mark for the default (unbranded) instance. Transparent background;
 * black glyph on light themes, Bitwarden blue (#175DDC) on dark.
 * Colored via currentColor so it follows the theme automatically.
 */
export function HuanMark({ size = 32, label, className, ...props }: HuanMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("huan-mark shrink-0 text-black [[data-theme=default-dark]_&]:text-[#175DDC]", className)}
      {...props}
    >
      {label ? <title>{label}</title> : null}
      <g transform={GLYPH_TRANSFORM}>
        <path fill="currentColor" d={GLYPH_PATH} />
      </g>
    </svg>
  );
}
