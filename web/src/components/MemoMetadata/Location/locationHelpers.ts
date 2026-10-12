import type { Location } from "@/types/proto/api/memo_service_pb";

/** placeholder is typed string, but defensive: a malformed payload would crash .trim(). */
const safePlaceholder = (location: Location): string =>
  typeof location.placeholder === "string" ? location.placeholder : "";

export const getLocationDisplayText = (location: Location): string => {
  return safePlaceholder(location).trim() || getLocationCoordinatesText(location);
};

export const getLocationCoordinatesText = (location: Location, digits = 4): string => {
  return `${location.latitude.toFixed(digits)}°, ${location.longitude.toFixed(digits)}°`;
};
