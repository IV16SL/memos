import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { isDarkTheme } from "@/utils/theme";
import { AmapTileLayer } from "./map-utils";

interface Props {
  onTileError?: () => void;
}

/** Amap (高德) basemap. Dark theme applies a CSS filter since Amap publishes no dark tile style. */
export function BasemapLayer({ onTileError }: Props) {
  const dark = isDarkTheme(useResolvedTheme());
  return <AmapTileLayer dark={dark} eventHandlers={{ tileerror: () => onTileError?.() }} />;
}
