// Esri tiles: keyless. OSM's own tile servers block many hosted apps.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";

export type BasemapId = "light" | "dark" | "satellite";

export interface Basemap {
  id: BasemapId;
  label: string;
  base: string;
  labels: string;
  attribution: string;
}

export const BASEMAPS: Record<BasemapId, Basemap> = {
  light: {
    id: "light",
    label: "Light",
    base: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ATTRIBUTION,
  },
  dark: {
    id: "dark",
    label: "Dark",
    base: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ATTRIBUTION,
  },
  satellite: {
    id: "satellite",
    label: "Satellite",
    base: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
  },
};

const STORAGE_KEY = "basemap";

export function loadBasemap(): BasemapId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in BASEMAPS) return saved as BasemapId;
  } catch {
    // storage unavailable (private mode etc.)
  }
  return "light";
}

export function saveBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}
