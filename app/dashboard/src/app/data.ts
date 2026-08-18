import rwandaGeo from "../imports/gadm41_RWA_3.json";
import rwandaProvinces from "../imports/rwanda_provinces_simplified.json";
import type { Coord, GadmFeature, MapFeature, ProvinceFeature, SectorAssessment } from "./types";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
export const TARGET_DISTRICTS = ["Gasabo", "Kicukiro", "Musanze", "Nyarugenge"];
export const CLASS_ORDER = ["Low", "Medium", "High"];
export const RISK_LEVELS = ["All Levels", "High", "Medium", "Low"];
export const PROVINCE_COLORS: Record<string, string> = {
  Kigali: "#38bdf8",
  Northern: "#f4e4c1",
  Southern: "#6366f1",
  Eastern: "#ffb4a2",
  Western: "#2563eb",
};

export const LON_MIN = 28.82;
export const LON_MAX = 30.94;
export const LAT_MAX = -1.0;
export const LAT_MIN = -2.88;
export const SVG_W = 520;
export const SVG_H = Math.round((SVG_W * (LAT_MAX - LAT_MIN)) / (LON_MAX - LON_MIN));
export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 3;
export const MAP_ZOOM_STEP = 0.35;

export function project([lon, lat]: Coord): Coord {
  return [
    ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * SVG_W,
    ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * SVG_H,
  ];
}

export function toSvgPath(coords: Coord[]): string {
  return (
    coords
      .map((coord, index) => {
        const [x, y] = project(coord);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

export function ringsFromMultiPolygon(coordinates: Coord[][][]): Coord[][] {
  return coordinates.flatMap((polygon) => polygon);
}

export function largestRing(rings: Coord[][]): Coord[] {
  return rings.reduce<Coord[]>((largest, ring) => (ring.length > largest.length ? ring : largest), []);
}

export function centroid(coords: Coord[]): Coord {
  if (!coords.length) return [SVG_W / 2, SVG_H / 2];
  const lon = coords.reduce((sum, [value]) => sum + value, 0) / coords.length;
  const lat = coords.reduce((sum, [, value]) => sum + value, 0) / coords.length;
  return project([lon, lat]);
}

export function projectedCentroid(coords: Coord[]): Coord {
  if (!coords.length) return [SVG_W / 2, SVG_H / 2];
  const projected = coords.map(project);
  const x = projected.reduce((sum, [value]) => sum + value, 0) / projected.length;
  const y = projected.reduce((sum, [, value]) => sum + value, 0) / projected.length;
  return [x, y];
}

export function multiPolygonToPath(coordinates: Coord[][][]): string {
  return ringsFromMultiPolygon(coordinates).map(toSvgPath).join(" ");
}

export function gadmFeatureToMapFeature(feature: GadmFeature, assessment?: SectorAssessment): MapFeature {
  const rings = ringsFromMultiPolygon(feature.geometry.coordinates);
  return {
    id: feature.properties.GID_3,
    name: assessment?.sector_name ?? feature.properties.NAME_3,
    district: assessment?.district ?? feature.properties.NAME_2,
    path: multiPolygonToPath(feature.geometry.coordinates),
    center: centroid(largestRing(rings)),
    assessment,
  };
}

export const FALLBACK_MAP_FEATURES: MapFeature[] = ((rwandaGeo as { features: GadmFeature[] }).features)
  .filter((feature) => TARGET_DISTRICTS.includes(feature.properties.NAME_2))
  .map((feature) => gadmFeatureToMapFeature(feature));

export const NATIONAL_MAP_FEATURES: MapFeature[] = ((rwandaGeo as { features: GadmFeature[] }).features).map((feature) =>
  gadmFeatureToMapFeature(feature),
);

export const PROVINCE_FEATURES: ProvinceFeature[] = Object.entries(rwandaProvinces as Record<string, Coord[]>).map(
  ([name, coords]) => ({
    name,
    path: toSvgPath(coords),
    center: projectedCentroid(coords),
    color: PROVINCE_COLORS[name] ?? "#94a3b8",
  }),
);
