import { useQuery } from "@tanstack/react-query";
import { gcj02ToWgs84, wgs84ToGcj02 } from "./gcj02";
import type { MapPoint } from "./types";

/** Amap Web API key for place search. Set via VITE_AMAP_API_KEY at build time. */
const AMAP_API_KEY = import.meta.env.VITE_AMAP_API_KEY as string | undefined;

const NOMINATIM = {
  endpoint: "https://nominatim.openstreetmap.org/search",
  userAgent: "Memos/1.0 (https://github.com/usememos/memos)",
  format: "json",
} as const;

/** Radius (meters) for the nearby-first search. Amap allows up to 50000. */
const AROUND_RADIUS = 50000;

export interface PlaceResult {
  name: string;
  address: string;
  /** WGS-84 coordinates (storage CRS). */
  lat: number;
  lng: number;
}

interface AmapPoi {
  name?: string;
  address?: string;
  /** "lng,lat" in GCJ-02. */
  location?: string;
}

function toPlaceResults(pois: AmapPoi[]): PlaceResult[] {
  return pois.flatMap((poi) => {
    const [lng, lat] = (poi.location ?? "").split(",").map(Number);
    if (!poi.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const [wLat, wLng] = gcj02ToWgs84(lat, lng);
    return [{ name: poi.name, address: poi.address ?? "", lat: wLat, lng: wLng }];
  });
}

async function fetchAmapPois(url: string): Promise<PlaceResult[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  if (data?.status !== "1") throw new Error(`Amap place search failed: ${data?.info ?? "unknown"}`);
  return toPlaceResults((data?.pois ?? []) as AmapPoi[]);
}

/** Nearby search around a center point, sorted by distance. */
async function searchAmapAround(query: string, center: MapPoint): Promise<PlaceResult[]> {
  // Amap expects GCJ-02 coordinates.
  const [gLat, gLng] = wgs84ToGcj02(center.lat, center.lng);
  const url =
    `https://restapi.amap.com/v3/place/around?key=${AMAP_API_KEY}` +
    `&location=${gLng},${gLat}&radius=${AROUND_RADIUS}` +
    `&keywords=${encodeURIComponent(query)}&sortrule=distance&extensions=base`;
  return fetchAmapPois(url);
}

/** Nationwide keyword search. */
async function searchAmapText(query: string): Promise<PlaceResult[]> {
  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_API_KEY}&keywords=${encodeURIComponent(query)}&extensions=base`;
  return fetchAmapPois(url);
}

interface NominatimResult {
  display_name?: string;
  lat?: string;
  lon?: string;
}

async function searchNominatim(query: string): Promise<PlaceResult[]> {
  const url = `${NOMINATIM.endpoint}?q=${encodeURIComponent(query)}&format=${NOMINATIM.format}&limit=8`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": NOMINATIM.userAgent,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = (await response.json()) as NominatimResult[];
  return data.flatMap((item) => {
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (!item.display_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const [name, ...rest] = item.display_name.split(", ");
    return [{ name, address: rest.join(", "), lat, lng }];
  });
}

async function searchPlaces(query: string, biasCenter?: MapPoint): Promise<PlaceResult[]> {
  if (!AMAP_API_KEY) return searchNominatim(query);
  // Nearby first: search around the bias center sorted by distance, so local
  // results rank above same-named places in other cities. Fall back to the
  // nationwide search when nothing is nearby.
  if (biasCenter) {
    try {
      const nearby = await searchAmapAround(query, biasCenter);
      if (nearby.length > 0) return nearby;
    } catch (error) {
      console.warn("Amap around search failed, falling back to text search:", error);
    }
  }
  return searchAmapText(query);
}

/**
 * Searches places by keyword. Amap when VITE_AMAP_API_KEY is set, Nominatim
 * otherwise. With an Amap key and a bias center, nearby results (50km,
 * distance-sorted) come first; the nationwide search is the fallback.
 */
export const usePlaceSearch = (query: string, biasCenter?: MapPoint) => {
  // Round the bias center (~1km) so map drags don't refetch the search.
  const biasKey = biasCenter ? `${biasCenter.lat.toFixed(2)},${biasCenter.lng.toFixed(2)}` : "";
  return useQuery({
    queryKey: ["place-search", query, biasKey],
    queryFn: () => searchPlaces(query, biasCenter),
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
};
