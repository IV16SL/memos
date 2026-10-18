import { type RefObject, useEffect, useRef, useState } from "react";
import { AMAP_STYLE_DARK, AMAP_STYLE_NORMAL, type AmapMap, type AmapStatic, loadAmap } from "./amap";
import { wgs84ToGcj02 } from "./gcj02";
import type { MapPoint } from "./types";

interface UseAmapMapOptions {
  /** Initial center (WGS-84). */
  center: MapPoint;
  /** Initial zoom. */
  zoom: number;
  dark: boolean;
  /** Drag/zoom/keyboard interaction. Defaults to true. */
  interactive?: boolean;
  /** Mouse-wheel zoom. Defaults to true. */
  scrollWheel?: boolean;
}

interface UseAmapMapResult {
  map: AmapMap | null;
  AMap: AmapStatic | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Creates an Amap JS API map inside the container. The map is created once;
 * only the dark style reacts to changes afterwards. Destroys the map on
 * unmount. When the API key is missing, `error` is set and callers should
 * render a fallback.
 */
export function useAmapMap(
  containerRef: RefObject<HTMLElement | null>,
  { center, zoom, dark, interactive = true, scrollWheel = true }: UseAmapMapOptions,
): UseAmapMapResult {
  const [map, setMap] = useState<AmapMap | null>(null);
  const [api, setApi] = useState<AmapStatic | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  useEffect(() => {
    let cancelled = false;
    let instance: AmapMap | null = null;
    loadAmap()
      .then((AMap) => {
        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;
        const [gLat, gLng] = wgs84ToGcj02(center.lat, center.lng);
        instance = new AMap.Map(el, {
          center: new AMap.LngLat(gLng, gLat),
          zoom,
          mapStyle: darkRef.current ? AMAP_STYLE_DARK : AMAP_STYLE_NORMAL,
          dragEnable: interactive,
          zoomEnable: interactive,
          keyboardEnable: interactive,
          doubleClickZoom: interactive,
          scrollWheel,
        });
        if (cancelled) {
          instance.destroy();
          return;
        }
        setApi(AMap);
        setMap(instance);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
      instance?.destroy();
      setMap(null);
      setApi(null);
    };
    // Center/zoom/interaction are initial-only; dark mode is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map?.setMapStyle(dark ? AMAP_STYLE_DARK : AMAP_STYLE_NORMAL);
  }, [map, dark]);

  return { map, AMap: api, error, loading: !map && !error };
}
