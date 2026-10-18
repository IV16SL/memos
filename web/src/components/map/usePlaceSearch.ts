import { useQuery } from "@tanstack/react-query";
import { gcj02ToWgs84 } from "./gcj02";

/** Amap Web API key for place search. Set via VITE_AMAP_API_KEY at build time. */
const AMAP_API_KEY = import.meta.env.VITE_AMAP_API_KEY as string | undefined;

const NOMINATIM = {
  endpoint: "https://nominatim.openstreetmap.org/search",
  userAgent: "Memos/1.0 (https://github.com/usememos/memos)",
  format: "json",
} as const;

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

async function searchAmap(query: string): Promise<PlaceResult[]> {
  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_API_KEY}&keywords=${encodeURIComponent(query)}&extensions=base`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  if (data?.status !== "1") throw new Error(`Amap place search failed: ${data?.info ?? "unknown"}`);
  const pois = (data?.pois ?? []) as AmapPoi[];
  return pois.flatMap((poi) => {
    const [lng, lat] = (poi.location ?? "").split(",").map(Number);
    if (!poi.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const [wLat, wLng] = gcj02ToWgs84(lat, lng);
    return [{ name: poi.name, address: poi.address ?? "", lat: wLat, lng: wLng }];
  });
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

/** Searches places by keyword. Amap when VITE_AMAP_API_KEY is set, Nominatim otherwise. */
export const usePlaceSearch = (query: string) => {
  return useQuery({
    queryKey: ["place-search", query],
    queryFn: () => (AMAP_API_KEY ? searchAmap(query) : searchNominatim(query)),
    enabled: query.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
};
