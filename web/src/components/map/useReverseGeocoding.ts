import { useQuery } from "@tanstack/react-query";
import { isAmapConfigured, loadAmap, loadAmapPlugins, type AmapStatic } from "./amap";
import { wgs84ToGcj02 } from "./gcj02";

const NOMINATIM = {
  endpoint: "https://nominatim.openstreetmap.org/reverse",
  userAgent: "Memos/1.0 (https://github.com/usememos/memos)",
  format: "json",
} as const;

/** Reverse-geocodes WGS-84 coordinates via the JS API Geocoder plugin. */
async function reverseGeocodeAmap(AMap: AmapStatic, lat: number, lng: number): Promise<string | undefined> {
  await loadAmapPlugins(AMap, ["AMap.Geocoder"]);
  // Amap expects GCJ-02 coordinates.
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  const geocoder = new AMap.Geocoder({ extensions: "base" });
  return new Promise((resolve, reject) => {
    geocoder.getAddress(new AMap.LngLat(gLng, gLat), (status, result) => {
      if (status === "complete") resolve(result.regeocode?.formattedAddress);
      else reject(new Error(`Amap regeo failed: ${status}`));
    });
  });
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
        // Reverse-geocode through the JS API plugin, using the same key +
        // security code as the map itself (no separate Web-service key needed).
        const address = isAmapConfigured()
          ? await reverseGeocodeAmap(await loadAmap(), lat, lng)
          : await reverseGeocodeNominatim(lat, lng);
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
