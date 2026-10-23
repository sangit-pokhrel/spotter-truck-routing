import type { Place } from "../api/types";

/** The device's current position as a Place (rejects if unavailable or denied). */
export function getCurrentPlace(label = "My location"): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location isn't available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ label, lat: coords.latitude, lon: coords.longitude }),
      () => reject(new Error("Couldn't get your location.")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
