import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  Eye,
  Filter,
  MapPin,
  Radio,
  Shield,
  TrendingUp,
  Users,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import rwandaGeo from "../imports/gadm41_RWA_3.json";
import rwandaProvinces from "../imports/rwanda_provinces_simplified.json";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const TARGET_DISTRICTS = ["Gasabo", "Kicukiro", "Musanze", "Nyarugenge"];
const CLASS_ORDER = ["Low", "Medium", "High"];
const RISK_LEVELS = ["All Levels", "High", "Medium", "Low"];
const PROVINCE_COLORS: Record<string, string> = {
  Kigali: "#38bdf8",
  Northern: "#f4e4c1",
  Southern: "#6366f1",
  Eastern: "#ffb4a2",
  Western: "#2563eb",
};

const LON_MIN = 28.82;
const LON_MAX = 30.94;
const LAT_MAX = -1.0;
const LAT_MIN = -2.88;
const SVG_W = 520;
const SVG_H = Math.round(SVG_W * (LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN));
const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 3;
const MAP_ZOOM_STEP = 0.35;

type Coord = [number, number];

type GadmFeature = {
  type: "Feature";
  properties: {
    GID_3: string;
    NAME_1: string;
    NAME_2: string;
    NAME_3: string;
  };
  geometry: {
    type: "MultiPolygon";
    coordinates: Coord[][][];
  };
};

type SectorAssessment = {
  sector_id: string;
  sector_name: string;
  district: string;
  proxy_class: string;
  proxy_score: number;
  proxy_rank: number;
  probability_low: number;
  probability_medium: number;
  probability_high: number;
  primary_model: string;
  model_predicted_class: string;
  model_probability: number;
  model_vulnerability_score: number;
  model_priority_rank: number;
  model_agrees_with_proxy_label: boolean;
  hybrid_model_weight: number;
  hybrid_indicator_weight: number;
  hybrid_model_contribution: number;
  hybrid_indicator_contribution: number;
  hybrid_vulnerability_score: number;
  hybrid_vulnerability_class: string;
  hybrid_priority_rank: number;
  population_total?: number | null;
  population_urban?: number | null;
  population_rural?: number | null;
  urban_share?: number | null;
  rural_share?: number | null;
  population_density_per_km2?: number | null;
  population_male?: number | null;
  population_female?: number | null;
  total_age_dependency_ratio?: number | null;
  district_age_share_0_14?: number | null;
  district_age_share_15_64?: number | null;
  district_age_share_65_plus?: number | null;
  component_density_pressure?: number | null;
  component_rurality_context?: number | null;
  component_district_age_dependency_context?: number | null;
  label_limitations?: string | null;
};

type DashboardSummary = {
  sector_count: number;
  district_count: number;
  training_row_count: number;
  independent_sector_count: number;
  class_counts: Record<string, number>;
  indicator_class_counts: Record<string, number>;
  predicted_class_counts: Record<string, number>;
  agreement_count: number;
  average_proxy_score: number;
  average_hybrid_score: number;
  population_total: number | null;
  best_model?: {
    model: string;
    macro_f1: number;
    balanced_accuracy: number;
    accuracy: number;
  };
  caveat: string;
};

type DashboardPayload = {
  summary: DashboardSummary;
  districts: string[];
  classes: string[];
  rankings: SectorAssessment[];
  model_performance: Array<Record<string, unknown>>;
  feature_importance: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
};

type SectorListPayload = {
  total: number;
  items: SectorAssessment[];
};

type MapFeature = {
  id: string;
  name: string;
  district: string;
  path: string;
  center: Coord;
  assessment?: SectorAssessment;
};

type ProvinceFeature = {
  name: string;
  path: string;
  center: Coord;
  color: string;
};

function project([lon, lat]: Coord): Coord {
  return [
    ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * SVG_W,
    ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * SVG_H,
  ];
}

function toSvgPath(coords: Coord[]): string {
  return (
    coords
      .map((coord, index) => {
        const [x, y] = project(coord);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

function ringsFromMultiPolygon(coordinates: Coord[][][]): Coord[][] {
  return coordinates.flatMap((polygon) => polygon);
}

function largestRing(rings: Coord[][]): Coord[] {
  return rings.reduce<Coord[]>((largest, ring) => (ring.length > largest.length ? ring : largest), []);
}

function centroid(coords: Coord[]): Coord {
  if (!coords.length) return [SVG_W / 2, SVG_H / 2];
  const lon = coords.reduce((sum, [value]) => sum + value, 0) / coords.length;
  const lat = coords.reduce((sum, [, value]) => sum + value, 0) / coords.length;
  return project([lon, lat]);
}

function projectedCentroid(coords: Coord[]): Coord {
  if (!coords.length) return [SVG_W / 2, SVG_H / 2];
  const projected = coords.map(project);
  const x = projected.reduce((sum, [value]) => sum + value, 0) / projected.length;
  const y = projected.reduce((sum, [, value]) => sum + value, 0) / projected.length;
  return [x, y];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function multiPolygonToPath(coordinates: Coord[][][]): string {
  return ringsFromMultiPolygon(coordinates).map(toSvgPath).join(" ");
}

function gadmFeatureToMapFeature(feature: GadmFeature, assessment?: SectorAssessment): MapFeature {
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

const FALLBACK_MAP_FEATURES: MapFeature[] = ((rwandaGeo as { features: GadmFeature[] }).features)
  .filter((feature) => TARGET_DISTRICTS.includes(feature.properties.NAME_2))
  .map((feature) => gadmFeatureToMapFeature(feature));

const NATIONAL_MAP_FEATURES: MapFeature[] = ((rwandaGeo as { features: GadmFeature[] }).features).map((feature) =>
  gadmFeatureToMapFeature(feature),
);

const PROVINCE_FEATURES: ProvinceFeature[] = Object.entries(rwandaProvinces as Record<string, Coord[]>).map(
  ([name, coords]) => ({
    name,
    path: toSvgPath(coords),
    center: projectedCentroid(coords),
    color: PROVINCE_COLORS[name] ?? "#94a3b8",
  }),
);

function riskStyle(level: string) {
  switch (level) {
    case "High":
      return {
        text: "text-red-400",
        bg: "bg-red-500/15",
        border: "border-red-500/30",
        dot: "bg-red-400",
        fill: "rgba(220,38,38,0.68)",
        stroke: "#f87171",
      };
    case "Medium":
      return {
        text: "text-orange-400",
        bg: "bg-orange-500/15",
        border: "border-orange-500/30",
        dot: "bg-orange-400",
        fill: "rgba(234,88,12,0.64)",
        stroke: "#fb923c",
      };
    case "Low":
      return {
        text: "text-emerald-400",
        bg: "bg-emerald-500/15",
        border: "border-emerald-500/30",
        dot: "bg-emerald-400",
        fill: "rgba(5,150,105,0.6)",
        stroke: "#34d399",
      };
    default:
      return {
        text: "text-cyan-300",
        bg: "bg-cyan-500/15",
        border: "border-cyan-500/30",
        dot: "bg-cyan-400",
        fill: "rgba(15,23,42,0.42)",
        stroke: "#64748b",
      };
  }
}

function scoreBarColor(level: string) {
  if (level === "High") return "bg-red-500";
  if (level === "Medium") return "bg-orange-500";
  if (level === "Low") return "bg-emerald-500";
  return "bg-cyan-500";
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatScoreOutOf100(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)} / 100`;
}

function formatContribution(value: number | null | undefined, weight: number) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * weight * 100).toFixed(1)} / 100`;
}

function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load dashboard data";
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [sectorRows, setSectorRows] = useState<SectorAssessment[]>([]);
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>(FALLBACK_MAP_FEATURES);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selDistrict, setSelDistrict] = useState("All Districts");
  const [selRisk, setSelRisk] = useState("All Levels");
  const [selSectorId, setSelSectorId] = useState<string | null>(null);
  const [hovSectorId, setHovSectorId] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState(1);
  const [infoTab, setInfoTab] = useState<"model" | "source" | "caveat">("model");

  useEffect(() => {
    let alive = true;

    async function loadDashboard() {
      try {
        setLoading(true);
        const [dashboardResponse, sectorsResponse, geoResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/dashboard`),
          fetch(`${API_BASE_URL}/api/sectors?limit=500`),
          fetch(`${API_BASE_URL}/api/map/sectors.geojson`),
        ]);
        if (!dashboardResponse.ok || !sectorsResponse.ok || !geoResponse.ok) {
          throw new Error("FastAPI returned an error while loading dashboard data.");
        }

        const dashboardJson = (await dashboardResponse.json()) as DashboardPayload;
        const sectorsJson = (await sectorsResponse.json()) as SectorListPayload;
        const geoJson = (await geoResponse.json()) as { features: GadmFeature[] };
        const rowLookup = new Map(sectorsJson.items.map((sector) => [sector.sector_id, sector]));
        const mapped = geoJson.features
          .filter((feature) => TARGET_DISTRICTS.includes(feature.properties.NAME_2))
          .map((feature) => gadmFeatureToMapFeature(feature, rowLookup.get(feature.properties.GID_3)));

        if (!alive) return;
        setDashboard(dashboardJson);
        setSectorRows(sectorsJson.items);
        setMapFeatures(mapped);
        setApiError(null);
      } catch (error) {
        if (!alive) return;
        setApiError(apiErrorMessage(error));
        setMapFeatures(FALLBACK_MAP_FEATURES);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      alive = false;
    };
  }, []);

  const districts = useMemo(() => {
    const fromApi = dashboard?.districts?.filter((district) => TARGET_DISTRICTS.includes(district)) ?? [];
    return fromApi.length ? fromApi : TARGET_DISTRICTS;
  }, [dashboard]);

  const sectorsForFilter = useMemo(() => {
    return sectorRows
      .filter((sector) => selDistrict === "All Districts" || sector.district === selDistrict)
      .sort((a, b) => a.sector_name.localeCompare(b.sector_name));
  }, [sectorRows, selDistrict]);

  const selectedSector = useMemo(() => {
    if (!selSectorId) return null;
    return sectorRows.find((sector) => sector.sector_id === selSectorId) ?? null;
  }, [sectorRows, selSectorId]);

  const hoveredSector = useMemo(() => {
    if (!hovSectorId) return null;
    return sectorRows.find((sector) => sector.sector_id === hovSectorId) ?? null;
  }, [sectorRows, hovSectorId]);

  const activeSector = selectedSector ?? hoveredSector;

  const activeMapFeature = useMemo(() => {
    const activeId = selSectorId ?? hovSectorId;
    if (!activeId) return null;
    return mapFeatures.find((feature) => feature.id === activeId) ?? null;
  }, [hovSectorId, mapFeatures, selSectorId]);

  const mapViewBox = useMemo(() => {
    const anchor = selSectorId ? activeMapFeature : null;
    const [cx, cy] = anchor?.center ?? [SVG_W / 2, SVG_H / 2];
    const viewWidth = SVG_W / mapZoom;
    const viewHeight = SVG_H / mapZoom;
    const x = clamp(cx - viewWidth / 2, 0, SVG_W - viewWidth);
    const y = clamp(cy - viewHeight / 2, 0, SVG_H - viewHeight);
    return `${x.toFixed(1)} ${y.toFixed(1)} ${viewWidth.toFixed(1)} ${viewHeight.toFixed(1)}`;
  }, [activeMapFeature, mapZoom, selSectorId]);

  const filteredRankings = useMemo(() => {
    return sectorRows
      .filter((sector) => selDistrict === "All Districts" || sector.district === selDistrict)
      .filter((sector) => selRisk === "All Levels" || sector.hybrid_vulnerability_class === selRisk)
      .filter((sector) => !selSectorId || sector.sector_id === selSectorId)
      .sort((a, b) => a.hybrid_priority_rank - b.hybrid_priority_rank);
  }, [sectorRows, selDistrict, selRisk, selSectorId]);

  const filteredMapFeatures = useMemo(() => {
    return mapFeatures.filter((feature) => {
      const assessment = feature.assessment;
      const okDistrict = selDistrict === "All Districts" || feature.district === selDistrict;
      const okRisk = selRisk === "All Levels" || assessment?.hybrid_vulnerability_class === selRisk;
      return okDistrict && okRisk;
    });
  }, [mapFeatures, selDistrict, selRisk]);

  const districtCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sectorRows.forEach((sector) => counts.set(sector.district, (counts.get(sector.district) ?? 0) + 1));
    return counts;
  }, [sectorRows]);

  const summary = dashboard?.summary;
  const totalPopulation = summary?.population_total ?? 0;

  function selectDistrict(district: string) {
    setSelDistrict(district);
    setSelSectorId(null);
  }

  function selectSector(sector: SectorAssessment) {
    setSelSectorId((current) => (current === sector.sector_id ? null : sector.sector_id));
  }

  return (
    <div
      className="w-full h-screen flex flex-col overflow-hidden bg-background text-foreground"
      style={{ fontFamily: "'Rajdhani','Inter',sans-serif" }}
    >
      <header className="shrink-0 border-b border-border bg-card px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 flex items-center justify-center">
            <Shield className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-white tracking-wider leading-tight truncate">
              Rwanda Informal Settlement Vulnerability Dashboard
            </h1>
          </div>
          <div className="w-px h-8 bg-border shrink-0 mx-1" />
          {/* <div
            className={`flex items-center gap-1.5 px-2 py-1 border rounded shrink-0 ${
              apiError ? "bg-red-500/10 border-red-500/25" : "bg-emerald-500/10 border-emerald-500/25"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${apiError ? "bg-red-400" : "bg-emerald-400"}`} />
            <span className={`text-[10px] font-mono tracking-widest ${apiError ? "text-red-400" : "text-emerald-400"}`}>
              {apiError ? "API FALLBACK" : loading ? "SYNC" : "LIVE API"}
            </span>
          </div> */}
          <div
            className="flex items-center gap-1.5 px-2 py-1 border rounded shrink-0 bg-emerald-500/10 border-emerald-500/25"
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-emerald-400" />
            <span className="text-[10px] font-mono tracking-widest text-emerald-400">
             SECTOR
            </span>
          </div>
        </div>
        <div
          className="flex items-center gap-5 text-[10px] text-muted-foreground shrink-0"
          style={{ fontFamily: "'JetBrains Mono',monospace" }}
        >
          {/* <span className="flex items-center gap-1.5">
            <Radio className="w-3 h-3 shrink-0" />
            Unit:
            <span className="text-cyan-300 ml-1">official sectors</span>
          </span> */}
          <span className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 shrink-0" />
            API:
            <a
              href={`${API_BASE_URL}/docs`}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 ml-1 hover:text-cyan-200 underline underline-offset-2"
            >
              Swagger documentation
            </a>
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 shrink-0" />
            Version:
            <span className="text-cyan-300 ml-1">1.0.1</span>
          </span>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-[220px_1fr_310px] min-h-0 overflow-hidden">
        <aside className="border-r border-border bg-card flex flex-col overflow-y-auto p-5 gap-4 scrollbar-none">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-cyan-400/85" />
              <span className="text-[10px] font-mono text-cyan-400/85 tracking-[0.18em] uppercase">Filters</span>
            </span>
            <button
              onClick={() => {
                setSelDistrict("All Districts");
                setSelRisk("All Levels");
                setSelSectorId(null);
                setMapZoom(1);
              }}
              className="text-[10px] font-mono text-muted-foreground/75 hover:text-cyan-300"
            >
              RESET
            </button>
          </div>

          <div>
            <p className="text-[10px] font-mono text-muted-foreground/90 uppercase mb-1.5">
              Estimated Vulnerability Level
            </p>
            <div className="space-y-0.5">
              {RISK_LEVELS.map((risk) => {
                const style = riskStyle(risk);
                const active = selRisk === risk;
                return (
                  <button
                    key={risk}
                    onClick={() => {
                      setSelRisk(risk);
                      setSelSectorId(null);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-semibold tracking-wide transition-all flex items-center justify-between ${
                      active
                        ? risk === "All Levels"
                          ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                          : `${style.bg} ${style.text} border ${style.border}`
                        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {risk !== "All Levels" && (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? style.dot : "bg-muted-foreground/30"}`} />
                      )}
                      {risk}
                    </span>
                    {risk !== "All Levels" && (
                      <span className="text-[10px] font-mono opacity-70">{summary?.class_counts?.[risk] ?? 0}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-muted-foreground/90 tracking-[0.14em] uppercase mb-1.5">District</p>
            <div className="space-y-0.5">
              <button
                onClick={() => selectDistrict("All Districts")}
                className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-semibold tracking-wide transition-all flex items-center justify-between ${
                  selDistrict === "All Districts"
                    ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                }`}
              >
                All Districts
                <span className="text-[10px] font-mono opacity-70">{summary?.sector_count ?? sectorRows.length}</span>
              </button>
              {districts.map((district) => {
                const active = selDistrict === district;
                return (
                  <button
                    key={district}
                    onClick={() => selectDistrict(district)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-semibold tracking-wide transition-all flex items-center justify-between ${
                      active
                        ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="truncate">{district}</span>
                    <span className="text-[10px] font-mono opacity-70">{districtCounts.get(district) ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-muted-foreground/90 tracking-[0.14em] uppercase mb-1.5">Sector</p>
            <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1 scrollbar-none">
              <button
                onClick={() => setSelSectorId(null)}
                className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-semibold tracking-wide transition-all ${
                  !selSectorId
                    ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                }`}
              >
                All Sectors
              </button>
              {sectorsForFilter.map((sector) => {
                const active = selSectorId === sector.sector_id;
                const style = riskStyle(sector.hybrid_vulnerability_class);
                return (
                  <button
                    key={sector.sector_id}
                    onClick={() => selectSector(sector)}
                    className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-semibold tracking-wide transition-all flex items-center justify-between gap-2 ${
                      active ? `${style.bg} ${style.text} border ${style.border}` : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="truncate">{sector.sector_name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-muted-foreground/90 uppercase mb-2">Vulnerability Level Legend</p>
            <div className="space-y-1.5">
              {CLASS_ORDER.slice().reverse().map((label) => {
                const style = riskStyle(label);
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className={`w-3 h-1.5 rounded-sm ${style.dot} opacity-80 shrink-0`} />
                    <span className="text-[11px] font-semibold text-muted-foreground flex-1">{label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/65">
                      {summary?.class_counts?.[label] ?? 0}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-muted-foreground/90 tracking-[0.14em] uppercase mb-2">
              Province Layer
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {PROVINCE_FEATURES.map((province) => (
                <div key={province.name} className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0 border border-white/25"
                    style={{ backgroundColor: province.color, boxShadow: `0 0 12px ${province.color}88` }}
                  />
                  <span className="text-[10px] font-semibold text-muted-foreground truncate">{province.name}</span>
                </div>
              ))}
            </div>
          </div>

          {apiError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 p-2">
              <p className="text-[10px] font-mono text-red-300 uppercase tracking-wider mb-1">API status</p>
              <p className="text-[11px] text-red-200/80 leading-snug">{apiError}</p>
            </div>
          )}
        </aside>

        <main className="relative bg-background overflow-y-auto overflow-x-hidden flex items-start justify-center">
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(#00C8E8 1px,transparent 1px),linear-gradient(90deg,#00C8E8 1px,transparent 1px)",
              backgroundSize: "36px 36px",
            }}
          />

          <div className="relative flex flex-col items-center gap-3 px-6 py-5 w-full">
            <div className="text-[9px] font-mono text-muted-foreground/80 tracking-[0.22em] uppercase">
              Rwanda provinces · highlighted assessed sectors in Musanze, Gasabo, Kicukiro, Nyarugenge
            </div>

            <div className="relative w-full flex justify-center">
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded border border-border bg-card/90 p-1 shadow-lg backdrop-blur">
                <button
                  type="button"
                  title="Zoom out"
                  aria-label="Zoom out"
                  onClick={() =>
                    setMapZoom((zoom) =>
                      clamp(zoom - MAP_ZOOM_STEP, MAP_ZOOM_MIN, MAP_ZOOM_MAX),
                    )
                  }
                  disabled={mapZoom <= MAP_ZOOM_MIN}
                  className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-cyan-300 hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Zoom in"
                  aria-label="Zoom in"
                  onClick={() =>
                    setMapZoom((zoom) =>
                      clamp(zoom + MAP_ZOOM_STEP, MAP_ZOOM_MIN, MAP_ZOOM_MAX),
                    )
                  }
                  disabled={mapZoom >= MAP_ZOOM_MAX}
                  className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-cyan-300 hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
              <svg
                viewBox={mapViewBox}
                className="w-full max-w-[760px]"
                onMouseLeave={() => setHovSectorId(null)}
                style={{ filter: "drop-shadow(0 0 70px rgba(0,200,232,0.09))" }}
              >
                <g aria-label="Rwanda province color layer" className="pointer-events-none">
                  {PROVINCE_FEATURES.map((province) => (
                    <path
                      key={`province-fill-${province.name}`}
                      d={province.path}
                      fill={province.color}
                      fillOpacity={0.24}
                      stroke={province.color}
                      strokeOpacity={0.72}
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>

                <g aria-label="Rwanda national sector basemap" className="pointer-events-none">
                  {NATIONAL_MAP_FEATURES.map((sector) => (
                    <path
                      key={`base-${sector.id}`}
                      d={sector.path}
                      fill="rgba(15,23,42,0.12)"
                      fillRule="evenodd"
                      stroke="rgba(203,213,225,0.28)"
                      strokeWidth={0.38}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>

                <g aria-label="Province boundary emphasis" className="pointer-events-none">
                  {PROVINCE_FEATURES.map((province) => (
                    <g key={`province-outline-${province.name}`}>
                      <path
                        d={province.path}
                        fill="none"
                        stroke="rgba(2,6,23,0.55)"
                        strokeWidth={3.1}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d={province.path}
                        fill="none"
                        stroke={province.color}
                        strokeOpacity={0.78}
                        strokeWidth={1.7}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={province.center[0]}
                        y={province.center[1]}
                        textAnchor="middle"
                        fill={province.color}
                        fillOpacity={0.92}
                        fontSize="8.5"
                        fontWeight="700"
                        fontFamily="'JetBrains Mono',monospace"
                        style={{ paintOrder: "stroke", stroke: "rgba(2,6,23,0.85)", strokeWidth: 2 }}
                      >
                        {province.name.toUpperCase()}
                      </text>
                    </g>
                  ))}
                </g>

                {filteredMapFeatures.map((sector) => {
                  const assessment = sector.assessment;
                  const style = riskStyle(assessment?.hybrid_vulnerability_class ?? "Unknown");
                  const isSelected = selSectorId === sector.id;
                  const isHovered = hovSectorId === sector.id;
                  const dimmed = selSectorId && !isSelected;

                  return (
                    <g key={sector.id}>
                      <path
                        d={sector.path}
                        fill={style.fill}
                        fillRule="evenodd"
                        stroke={isSelected || isHovered ? "#f8fafc" : style.stroke}
                        strokeWidth={isSelected || isHovered ? 1.35 : 0.9}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        opacity={dimmed ? 0.48 : 1}
                        className="cursor-pointer"
                        onClick={() => {
                          if (assessment) selectSector(assessment);
                        }}
                        onMouseEnter={() => setHovSectorId(sector.id)}
                      >
                        <title>
                          {assessment
                            ? `${assessment.sector_name} · ${assessment.district} · hybrid ${assessment.hybrid_vulnerability_class} · rank ${assessment.hybrid_priority_rank}`
                            : `${sector.name} · ${sector.district}`}
                        </title>
                      </path>
                    </g>
                  );
                })}

                <g aria-label="High risk pulse indicators" className="pointer-events-none">
                  {filteredMapFeatures
                    .filter((sector) => sector.assessment?.hybrid_vulnerability_class === "High")
                    .map((sector) => (
                      <g key={`pulse-${sector.id}`}>
                        <circle
                          cx={sector.center[0]}
                          cy={sector.center[1]}
                          r="2.2"
                          fill="#ef4444"
                          opacity="0.96"
                        />
                        <circle
                          cx={sector.center[0]}
                          cy={sector.center[1]}
                          r="4.2"
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth="1.2"
                          opacity="0.75"
                        >
                          <animate attributeName="r" values="3.4;9.5;3.4" dur="2.2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.72;0.04;0.72" dur="2.2s" repeatCount="indefinite" />
                        </circle>
                        <circle
                          cx={sector.center[0]}
                          cy={sector.center[1]}
                          r="6"
                          fill="#ef4444"
                          opacity="0.14"
                        >
                          <animate attributeName="opacity" values="0.08;0.24;0.08" dur="1.35s" repeatCount="indefinite" />
                        </circle>
                      </g>
                    ))}
                </g>

                {activeMapFeature && activeSector && (
                  <g className="pointer-events-none">
                    <path
                      d={activeMapFeature.path}
                      fill="none"
                      stroke={riskStyle(activeSector.hybrid_vulnerability_class).stroke}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={activeMapFeature.center[0]}
                      cy={activeMapFeature.center[1]}
                      r="2.3"
                      fill={riskStyle(activeSector.hybrid_vulnerability_class).stroke}
                      opacity="0.95"
                    />
                  </g>
                )}

                <g transform={`translate(${SVG_W - 28},22)`}>
                  <text textAnchor="middle" y={-10} fill="rgba(0,200,232,0.4)" fontSize="7" fontFamily="'JetBrains Mono',monospace">
                    N
                  </text>
                  <line x1="0" y1="-6" x2="0" y2="6" stroke="rgba(0,200,232,0.3)" strokeWidth="0.8" />
                  <line x1="-6" y1="0" x2="6" y2="0" stroke="rgba(0,200,232,0.2)" strokeWidth="0.8" />
                  <polygon points="0,-6 2,0 -2,0" fill="rgba(0,200,232,0.5)" />
                </g>
              </svg>
            </div>

            <div className={`transition-all duration-200 w-full max-w-[760px] ${activeSector ? "opacity-100" : "opacity-100"}`}>
              <div className="bg-popover border border-border rounded-lg px-4 py-3">
                {activeSector ? (
                  <>
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <div className="min-w-0">
                        <div className="text-[9px] font-mono text-muted-foreground tracking-wider uppercase mb-0.5">
                          {activeSector.district} District · Official Sector
                        </div>
                        <div className="text-sm font-bold text-white tracking-wide truncate">{activeSector.sector_name}</div>
                      </div>
                      <div
                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap ${riskStyle(activeSector.hybrid_vulnerability_class).bg} ${
                          riskStyle(activeSector.hybrid_vulnerability_class).text
                        } border ${riskStyle(activeSector.hybrid_vulnerability_class).border}`}
                      >
                        {activeSector.hybrid_vulnerability_class.toUpperCase()} FINAL VULNERABILITY LEVEL
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mb-2">
                      {[
                        { label: "Hybrid Vulnerability Score", value: formatScoreOutOf100(activeSector.hybrid_vulnerability_score), color: riskStyle(activeSector.hybrid_vulnerability_class).text, size: "text-lg" },
                        { label: "Final Priority Rank", value: `#${activeSector.hybrid_priority_rank}`, color: "text-white", size: "text-lg" },
                        { label: "Vulnerability Level", value: activeSector.hybrid_vulnerability_class, color: riskStyle(activeSector.hybrid_vulnerability_class).text, size: "text-base" },
                        { label: "RF Confidence", value: formatPercent(activeSector.model_probability), color: "text-cyan-400", size: "text-lg" },
                      ].map((item) => (
                        <div key={item.label}>
                          <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-widest mb-0.5">
                            {item.label}
                          </div>
                          <div className={`${item.size} font-bold font-mono leading-tight ${item.color}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground/90">
                      <span className="text-muted-foreground/90 uppercase tracking-wider">Final score</span>
                      <span>60% RF {formatScoreOutOf100(activeSector.model_vulnerability_score)}</span>
                      <span>+</span>
                      <span>40% indicator {formatScoreOutOf100(activeSector.proxy_score)}</span>
                      <span className="text-cyan-300">= {formatScoreOutOf100(activeSector.hybrid_vulnerability_score)}</span>
                    </div> */}
                    <div className="flex items-center gap-4 mt-1 text-[9px] font-mono text-muted-foreground/80">
                      {/* <span className="text-muted-foreground/65 uppercase tracking-wider">RF probabilities · score = High + ½ Medium</span> */}
                      <span>Low {formatPercent(activeSector.probability_low, 0)}</span>
                      <span>Medium {formatPercent(activeSector.probability_medium, 0)}</span>
                      <span>High {formatPercent(activeSector.probability_high, 0)}</span>
                    </div>

                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="text-[9px] font-mono text-cyan-400/85 tracking-[0.18em] uppercase">
                          Hybrid assessment components
                        </div>
                        <div className="text-[8px] font-mono text-muted-foreground/90 uppercase tracking-wider">
                          Transparent 60 / 40 fusion
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {[
                          { label: "RF Estimate", value: activeSector.model_predicted_class, tone: riskStyle(activeSector.model_predicted_class).text },
                          { label: "RF Contribution", value: formatScoreOutOf100(activeSector.hybrid_model_contribution), tone: "text-cyan-300" },
                          { label: "Indicator Level", value: activeSector.proxy_class, tone: riskStyle(activeSector.proxy_class).text },
                          { label: "Indicator Contribution", value: formatScoreOutOf100(activeSector.hybrid_indicator_contribution), tone: "text-cyan-300" },
                        ].map((item) => (
                          <div key={item.label} className="rounded border border-border bg-secondary/30 px-3 py-2 min-w-0">
                            <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-widest">{item.label}</div>
                            <div className={`text-sm font-bold font-mono ${item.tone}`}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {[
                          { label: "Population", value: formatNumber(activeSector.population_total), tone: "text-white" },
                          { label: "Density (people/km²)", value: formatNumber(activeSector.population_density_per_km2, 0), tone: "text-cyan-300" },
                          { label: "Urban", value: `${formatNumber(activeSector.population_urban)} (${formatPercent(activeSector.urban_share, 0)})`, tone: "text-sky-300" },
                          { label: "Rural", value: `${formatNumber(activeSector.population_rural)} (${formatPercent(activeSector.rural_share, 0)})`, tone: "text-emerald-300" },
                        ].map((item) => (
                          <div key={item.label} className="rounded border border-border bg-secondary/40 px-2 py-1.5 min-w-0">
                            <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-widest truncate">
                              {item.label}
                            </div>
                            <div className={`text-sm font-bold font-mono leading-tight truncate ${item.tone}`}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label: "Male population", value: formatNumber(activeSector.population_male) },
                          { label: "Female population", value: formatNumber(activeSector.population_female) },
                        ].map((item) => (
                          <div key={item.label} className="rounded border border-border bg-secondary/30 px-3 py-2">
                            <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-widest">{item.label}</div>
                            <div className="text-sm font-bold font-mono text-white">{item.value}</div>
                          </div>
                        ))}
                        <div className="rounded border border-border bg-secondary/30 px-3 py-2 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-widest truncate">
                              {activeSector.district} age groups
                            </div>
                            <div className="text-[7px] font-mono text-muted-foreground/80 uppercase shrink-0">District-level</div>
                          </div>
                          <div className="grid grid-cols-3 gap-1 mt-1">
                            {[
                              { label: "0–14", value: activeSector.district_age_share_0_14 },
                              { label: "15–64", value: activeSector.district_age_share_15_64 },
                              { label: "65+", value: activeSector.district_age_share_65_plus },
                            ].map((group) => (
                              <div key={group.label} className="min-w-0">
                                <div className="text-[8px] font-mono text-muted-foreground/90">{group.label}</div>
                                <div className="text-[11px] font-bold font-mono text-cyan-300">
                                  {formatPercent(group.value, 0)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="text-[8px] font-mono text-muted-foreground/90 uppercase tracking-widest mb-1.5">
                        Indicator score calculation
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-[9px] font-mono">
                        {[
                          {
                            label: "Density contribution",
                            detail: `40% weight · pressure ${formatPercent(activeSector.component_density_pressure, 1)}`,
                            value: formatContribution(activeSector.component_density_pressure, 0.4),
                          },
                          {
                            label: "Rurality contribution",
                            detail: `35% weight · rural ${formatPercent(activeSector.rural_share, 0)}`,
                            value: formatContribution(activeSector.component_rurality_context, 0.35),
                          },
                          {
                            label: "Age contribution",
                            detail: `25% weight · district dependency ${formatPercent(activeSector.total_age_dependency_ratio, 0)}`,
                            value: formatContribution(activeSector.component_district_age_dependency_context, 0.25),
                          },
                          {
                            label: "Total score",
                            detail: "Sum of weighted contributions",
                            value: formatScoreOutOf100(activeSector.proxy_score),
                          },
                        ].map((item) => (
                          <div key={item.label} className="rounded bg-background/60 border border-border px-2 py-1.5 min-w-0">
                            <div className="text-muted-foreground/75 uppercase tracking-wider leading-tight">{item.label}</div>
                            <div className="text-[8px] text-muted-foreground/65 leading-tight mt-0.5 min-h-5">{item.detail}</div>
                            <div className="text-cyan-300 font-bold mt-1">{item.value}</div>
                          </div>
                        ))}
                      </div>

                      {activeSector.label_limitations && (
                        <div className="mt-2 text-[9px] leading-snug text-muted-foreground/80">
                          {activeSector.label_limitations}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[9px] font-mono text-muted-foreground tracking-wider uppercase mb-0.5">
                        {loading ? "Loading FastAPI outputs" : "Sector map ready"}
                      </div>
                      <div className="text-sm font-bold text-white tracking-wide">
                        {filteredMapFeatures.length} sectors in current view
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground/80">Click a sector for details</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        <aside className="border-l border-border bg-card flex flex-col overflow-hidden">
          <div className="px-5 py-5 border-b border-border shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400/85" />
              <span className="text-[10px] font-mono text-cyan-400/85 tracking-[0.18em] uppercase">Sector Rankings</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground/65">{filteredRankings.length} sectors</span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-none">
            {filteredRankings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground/80">
                <Eye className="w-6 h-6" />
                <span className="text-xs font-mono">No sectors match filters</span>
              </div>
            ) : (
              <div className="divide-y divide-secondary/60">
                {filteredRankings.map((sector) => {
                  const style = riskStyle(sector.hybrid_vulnerability_class);
                  const active = selSectorId === sector.sector_id;
                  return (
                    <button
                      key={sector.sector_id}
                      onClick={() => selectSector(sector)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        active ? "bg-cyan-500/[0.08]" : "hover:bg-cyan-500/[0.04]"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`text-[12px] font-mono font-bold shrink-0 mt-0.5 w-7 ${
                            sector.hybrid_priority_rank <= 5 ? "text-red-400" : "text-muted-foreground/65"
                          }`}
                        >
                          {String(sector.hybrid_priority_rank).padStart(2, "0")}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-1 mb-0.5">
                            <span className="text-[13px] font-semibold text-foreground leading-tight truncate">
                              {sector.sector_name}
                            </span>
                            <span className={`text-[13px] font-bold font-mono shrink-0 ${style.text}`}>
                              {formatScoreOutOf100(sector.hybrid_vulnerability_score).replace(" / ", "/")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <MapPin className="w-2.5 h-2.5 text-muted-foreground/65 shrink-0" />
                            <span className="text-[10px] font-mono text-muted-foreground/80 flex-1 truncate">
                              {sector.district}
                            </span>
                            <span className={`text-[10px] font-mono shrink-0 ${style.text}`}>{sector.hybrid_vulnerability_class}</span>
                          </div>
                          <div className="h-[2px] bg-secondary rounded-full overflow-hidden mb-1.5">
                            <div
                              className={`h-full rounded-full ${scoreBarColor(sector.hybrid_vulnerability_class)}`}
                              style={{ width: `${Math.min(100, sector.hybrid_vulnerability_score * 100)}%` }}
                            />
                          </div>
                          {/* <div className="flex flex-wrap gap-1">
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${style.bg} ${style.text} ${style.border}`}>
                              final {sector.hybrid_vulnerability_class}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-secondary text-muted-foreground/80">
                              indicator {sector.proxy_class}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-secondary text-muted-foreground/80">
                              RF {formatScoreOutOf100(sector.model_vulnerability_score).replace(" / ", "/")}
                            </span>
                          </div> */}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t border-border shrink-0 flex items-center gap-2">
            <Users className="w-3 h-3 text-muted-foreground/65 shrink-0" />
            <span className="text-[10px] font-mono text-muted-foreground/75 flex-1">Population in assessed sectors</span>
            <span className="text-[11px] font-mono font-bold text-cyan-400">{totalPopulation.toLocaleString()}</span>
          </div>
        </aside>
      </div>

      <footer className="shrink-0 border-t border-border bg-card">
        <div className="flex border-b border-border">
          {[
            { label: "Sectors Assessed", value: String(summary?.sector_count ?? sectorRows.length), icon: MapPin, color: "text-cyan-400" },
            { label: "High Vulnerability", value: String(summary?.class_counts?.High ?? 0), icon: AlertTriangle, color: "text-red-400" },
            { label: "Medium Vulnerability", value: String(summary?.class_counts?.Medium ?? 0), icon: Zap, color: "text-orange-400" },
            { label: "Low Vulnerability", value: String(summary?.class_counts?.Low ?? 0), icon: Shield, color: "text-emerald-400" },
            { label: "Average Hybrid Score", value: summary ? formatScoreOutOf100(summary.average_hybrid_score) : "n/a", icon: Activity, color: "text-yellow-400" },
            {
              label: "Best Macro F1",
              value: summary?.best_model ? formatPercent(summary.best_model.macro_f1) : "n/a",
              icon: TrendingUp,
              color: "text-cyan-400",
            },
          ].map((stat) => (
            <div key={stat.label} className="flex-1 px-4 py-2 border-r border-border last:border-r-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <stat.icon className={`w-3 h-3 ${stat.color} shrink-0`} />
                <span className="text-[8px] font-mono text-muted-foreground/75 uppercase tracking-wider truncate">
                  {stat.label}
                </span>
              </div>
              <span className={`text-lg font-bold font-mono leading-none ${stat.color}`}>{stat.value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-stretch">
          <div className="flex shrink-0 border-r border-border">
            {(["model", "source", "caveat"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setInfoTab(tab)}
                className={`px-4 py-2 text-[9px] font-mono tracking-[0.16em] uppercase transition-all border-b-2 ${
                  infoTab === tab
                    ? "text-cyan-400 border-cyan-400 bg-cyan-500/5"
                    : "text-muted-foreground/75 border-transparent hover:text-muted-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div
            className="flex-1 px-4 py-2 flex items-center gap-x-6 flex-wrap text-[10px] text-muted-foreground/80 overflow-hidden"
            style={{ fontFamily: "'JetBrains Mono',monospace" }}
          >
            {infoTab === "model" && (
              <>
                <span>
                  <span className="text-muted-foreground">Final index:</span> 60% Random Forest + 40% census indicator
                </span>
                <span>
                  <span className="text-muted-foreground">Comparison:</span> CatBoost
                </span>
                <span>
                  <span className="text-muted-foreground">Rows:</span> {summary?.training_row_count ?? 500}
                </span>
                <span>
                  <span className="text-muted-foreground">Independent sectors:</span> {summary?.independent_sector_count ?? 50}
                </span>
                <span>
                  <span className="text-muted-foreground">Best model:</span>{" "}
                  <span className="text-emerald-400 font-bold">{summary?.best_model?.model ?? "random_forest"}</span>
                </span>
              </>
            )}
            {infoTab === "source" && (
              <>
                <span>
                  <span className="text-muted-foreground">Sentinel-2</span> · subunit spectral and terrain summaries
                </span>
                <span>
                  <span className="text-muted-foreground">NISR</span> · population and census-derived vulnerability indicators
                </span>
                <span>
                  <span className="text-muted-foreground">GADM</span> · level-3 sector boundaries
                </span>
              </>
            )}
            {infoTab === "caveat" && (
              <>
                <span>
                  Hybrid weights are explicit decision weights; results are not official Ubudehe classifications or household-level assessments.
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 px-4 shrink-0 text-[9px] font-mono text-muted-foreground/80">
            <Database className="w-3 h-3" />
            <span>RVIS · API v0.3</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
