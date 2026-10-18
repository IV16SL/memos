import { useQuery } from "@tanstack/react-query";
import { isAmapConfigured, loadAmap, loadAmapPlugins, type AmapPlaceSearch, type AmapPlaceSearchResult, type AmapStatic } from "./amap";
import { gcj02ToWgs84, wgs84ToGcj02 } from "./gcj02";
import type { MapPoint } from "./types";

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

function toPlaceResults(result: AmapPlaceSearchResult): PlaceResult[] {
  const pois = result.poiList?.pois ?? [];
  return pois.flatMap((poi) => {
    const lng = poi.location?.getLng();
    const lat = poi.location?.getLat();
    if (!poi.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const [wLat, wLng] = gcj02ToWgs84(lat, lng);
    return [{ name: poi.name, address: poi.address ?? "", lat: wLat, lng: wLng }];
  });
}

function searchWith(searcher: AmapPlaceSearch, keywords: string): Promise<PlaceResult[]> {
  return new Promise((resolve, reject) => {
    searcher.search(keywords, (status, result) => {
      if (status === "complete" || status === "no_data") resolve(toPlaceResults(result));
      else reject(new Error(`Amap place search failed: ${status}`));
    });
  });
}

function searchNearByWith(searcher: AmapPlaceSearch, AMap: AmapStatic, keywords: string, center: MapPoint): Promise<PlaceResult[]> {
  // Amap expects GCJ-02 coordinates.
  const [gLat, gLng] = wgs84ToGcj02(center.lat, center.lng);
  return new Promise((resolve, reject) => {
    searcher.searchNearBy(keywords, new AMap.LngLat(gLng, gLat), AROUND_RADIUS, (status, result) => {
      if (status === "complete" || status === "no_data") resolve(toPlaceResults(result));
      else reject(new Error(`Amap nearby search failed: ${status}`));
    });
  });
}

/** Haversine distance in meters between two WGS-84 points. */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
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
  // Without an Amap key, fall back to Nominatim.
  if (!isAmapConfigured()) return searchNominatim(query);
  // Place search runs through the JS API plugin, so it uses the same key +
  // security code as the map itself (no separate Web-service key needed).
  const AMap = await loadAmap();
  await loadAmapPlugins(AMap, ["AMap.PlaceSearch"]);
  const searcher = new AMap.PlaceSearch({ pageSize: 10, extensions: "base" });

  // Run nearby and nationwide in parallel. Nearby results come first
  // (distance-sorted) so local matches outrank same-named places in other
  // cities; nationwide results follow (deduplicated) so other cities stay
  // searchable.
  const [nearby, nationwide] = await Promise.all([
    biasCenter
      ? searchNearByWith(searcher, AMap, query, biasCenter).catch((error) => {
          console.warn("Amap nearby search failed:", error);
          return [] as PlaceResult[];
        })
      : Promise.resolve([] as PlaceResult[]),
    searchWith(searcher, query).catch((error) => {
      console.warn("Amap nationwide search failed:", error);
      return [] as PlaceResult[];
    }),
  ]);

  const sortByDistance = (list: PlaceResult[]) =>
    biasCenter
      ? [...list].sort(
          (a, b) =>
            distanceMeters(biasCenter.lat, biasCenter.lng, a.lat, a.lng) -
            distanceMeters(biasCenter.lat, biasCenter.lng, b.lat, b.lng),
        )
      : list;

  const seen = new Set<string>();
  const merged: PlaceResult[] = [];
  for (const place of [...sortByDistance(nearby), ...nationwide]) {
    if (seen.has(place.name)) continue;
    seen.add(place.name);
    merged.push(place);
  }
  return merged;
}

/**
 * Searches places by keyword. Amap (via the JS API PlaceSearch plugin) when
 * configured, Nominatim otherwise. With a bias center, nearby results (50km,
 * distance-sorted) come first, then nationwide results (deduplicated) so
 * other cities stay searchable.
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
