/**
 * Amap (高德) JS API v2 loader and minimal ambient types.
 *
 * The SDK is loaded from Amap's CDN with a script tag (no npm dependency).
 * Requires VITE_AMAP_API_KEY (with the "Web端 (JS API)" service enabled) and
 * VITE_AMAP_SECURITY_CODE (安全密钥) at build time.
 */

/** Amap JS API key. */
const AMAP_JS_KEY = import.meta.env.VITE_AMAP_API_KEY as string | undefined;
/** Amap JS API security code (安全密钥), mandatory for the JS API. */
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined;

/** Whether the Amap JS API can be loaded (key + security code present). */
export const isAmapConfigured = (): boolean => Boolean(AMAP_JS_KEY && AMAP_SECURITY_CODE);

/** Missing-key notice shown where a map would render. */
export const AMAP_MISSING_KEY_MESSAGE = "地图需要配置高德 Key (VITE_AMAP_API_KEY / VITE_AMAP_SECURITY_CODE)";

// --- Minimal ambient types for the Amap JS API surface we use. ---

export interface AmapLngLat {
  getLng(): number;
  getLat(): number;
}

export interface AmapPixel {
  getX(): number;
  getY(): number;
}

export interface AmapSize {
  getWidth(): number;
  getHeight(): number;
}

export interface AmapBounds {
  contains(lnglat: AmapLngLat | [number, number]): boolean;
}

export interface AmapMap {
  on(event: string, handler: (e: AmapMapEvent) => void): void;
  off(event: string, handler: (e: AmapMapEvent) => void): void;
  setCenter(lnglat: AmapLngLat | [number, number]): void;
  getCenter(): AmapLngLat;
  getBounds(): AmapBounds;
  setZoom(zoom: number): void;
  getZoom(): number;
  setZoomAndCenter(zoom: number, lnglat: AmapLngLat | [number, number]): void;
  zoomIn(): void;
  zoomOut(): void;
  setFitView(overlays?: AmapMarker[], immediately?: boolean, avoid?: number[], maxZoom?: number): void;
  lngLatToContainer(lnglat: AmapLngLat | [number, number]): AmapPixel;
  containerToLngLat(pixel: AmapPixel): AmapLngLat;
  getSize(): AmapSize;
  panBy(x: number, y: number): void;
  setMapStyle(style: string): void;
  setFeatures(features: string[]): void;
  add(marker: AmapMarker | AmapMarker[]): void;
  remove(marker: AmapMarker | AmapMarker[]): void;
  clearMap(): void;
  destroy(): void;
}

export interface AmapMapEvent {
  lnglat: AmapLngLat;
  pixel: AmapPixel;
  target: AmapMap;
}

export interface AmapMarkerOptions {
  position?: AmapLngLat | [number, number];
  content?: string | HTMLElement;
  offset?: AmapPixel;
  title?: string;
  clickable?: boolean;
  zIndex?: number;
}

export interface AmapMarker {
  setPosition(lnglat: AmapLngLat | [number, number]): void;
  getPosition(): AmapLngLat;
  setContent(content: string | HTMLElement): void;
  setTitle(title: string): void;
  setzIndex(z: number): void;
  setExtData(data: unknown): void;
  getExtData(): unknown;
  on(event: string, handler: (e: AmapMapEvent) => void): void;
  off(event: string, handler: (e: AmapMapEvent) => void): void;
  setMap(map: AmapMap | null): void;
}

export interface AmapStatic {
  Map: new (container: string | HTMLElement, opts?: Record<string, unknown>) => AmapMap;
  Marker: new (opts?: AmapMarkerOptions) => AmapMarker;
  LngLat: new (lng: number, lat: number) => AmapLngLat;
  Pixel: new (x: number, y: number) => AmapPixel;
  Size: new (width: number, height: number) => AmapSize;
}

declare global {
  interface Window {
    AMap?: AmapStatic;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

let loadPromise: Promise<AmapStatic> | null = null;

/** Loads the Amap JS API (singleton). Rejects when the key is not configured. */
export function loadAmap(): Promise<AmapStatic> {
  if (!isAmapConfigured()) {
    return Promise.reject(new Error(AMAP_MISSING_KEY_MESSAGE));
  }
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<AmapStatic>((resolve, reject) => {
    if (window.AMap) {
      resolve(window.AMap);
      return;
    }
    // The security config must be set before the SDK script loads.
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE! };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_JS_KEY}`;
    script.async = true;
    script.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else {
        loadPromise = null;
        reject(new Error("Amap JS API failed to initialize"));
      }
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Amap JS API"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** Official Amap map styles. */
export const AMAP_STYLE_NORMAL = "amap://styles/normal";
export const AMAP_STYLE_DARK = "amap://styles/dark";

/** Default map features (vector layers). "point" is the POI label layer. */
export const AMAP_FEATURES_DEFAULT = ["bg", "road", "building", "point"];
