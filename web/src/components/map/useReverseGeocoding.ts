import { useQuery } from "@tanstack/react-query";
import { wgs84ToGcj02 } from "./gcj02";

/** Amap Web API key for reverse geocoding. Get one at https://console.amap.com/ (free tier suffices). */
const AMAP_API_KEY = "";

const NOMINATIM = {
  endpoint: "https://nominatim.openstreetmap.org/reverse",
  userAgent: "Memos/1.0 (https://github.com/usememos/memos)",
  format: "json",
} as const;

async function reverseGeocodeAmap(lat: number, lng: number): Promise<string | undefined> {
  // Amap expects GCJ-02 coordinates.
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const url = `https://restapi.amap.com/v3/geocode/regeo?key=${AMAP_API_KEY}&location=${gLng},${gLat}&extensions=base`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  if (data?.status === "1") return data?.regeocode?.formatted_address as string | undefined;
  throw new Error(`Amap regeo failed: ${data?.info ?? "unknown"}`);
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string | undefined> {
  const url = `${NOMINATIM.endpoint}?lat=${lat}&lon=${lng}&format=${NOMINATIM.format}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": NOMINATIM.userAgent,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  return data?.display_name as string | undefined;
}

export const useReverseGeocoding = (lat: number | undefined, lng: number | undefined) => {
  return useQuery({
    queryKey: ["geocoding", lat, lng],
    queryFn: async () => {
      const coordString = `${lat?.toFixed(6)}, ${lng?.toFixed(6)}`;
      if (lat === undefined || lng === undefined) return "";

      try {
        const address = AMAP_API_KEY ? await reverseGeocodeAmap(lat, lng) : await reverseGeocodeNominatim(lat, lng);
        return address || coordString;
      } catch (error) {
        console.error("Failed to fetch reverse geocoding data:", error);
        return coordString;
      }
    },
    enabled: lat !== undefined && lng !== undefined,
    staleTime: Infinity,
  });
};
