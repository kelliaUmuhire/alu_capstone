import { useEffect, useMemo, useState } from "react";
import {
  API_BASE_URL,
  FALLBACK_MAP_FEATURES,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  MAP_ZOOM_STEP,
  PROVINCE_FEATURES,
  SVG_H,
  SVG_W,
  TARGET_DISTRICTS,
  gadmFeatureToMapFeature,
} from "./data";
import { BottomFooter } from "./components/BottomFooter";
import { DashboardHeader } from "./components/DashboardHeader";
import { FilterSidebar } from "./components/FilterSidebar";
import { MapPanel } from "./components/MapPanel";
import { RankingSidebar } from "./components/RankingSidebar";
import { SectorDetailCard } from "./components/SectorDetailCard";
import { StartupPanel } from "./components/StartupPanel";
import type { DashboardPayload, GadmFeature, MapFeature, SectorAssessment, SectorListPayload } from "./types";
import { apiErrorMessage, clamp } from "./utils";

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [sectorRows, setSectorRows] = useState<SectorAssessment[]>([]);
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>(FALLBACK_MAP_FEATURES);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [startupElapsedSeconds, setStartupElapsedSeconds] = useState(0);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selDistrict, setSelDistrict] = useState("All Districts");
  const [selRisk, setSelRisk] = useState("All Levels");
  const [selSectorId, setSelSectorId] = useState<string | null>(null);
  const [hovSectorId, setHovSectorId] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState(1);
  const [infoTab, setInfoTab] = useState<"model" | "source" | "caveat">("model");

  useEffect(() => {
    let alive = true;

    setStartupElapsedSeconds(0);
    const startupTimer = window.setInterval(() => {
      setStartupElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    async function loadDashboard() {
      try {
        setLoading(true);
        setApiError(null);
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
        window.clearInterval(startupTimer);
        if (alive) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      alive = false;
      window.clearInterval(startupTimer);
    };
  }, [loadAttempt]);

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
  const showStartupPanel = !dashboard && (loading || Boolean(apiError));

  function selectDistrict(district: string) {
    setSelDistrict(district);
    setSelSectorId(null);
  }

  function selectSector(sector: SectorAssessment) {
    setSelSectorId((current) => (current === sector.sector_id ? null : sector.sector_id));
  }

  function resetFilters() {
    setSelDistrict("All Districts");
    setSelRisk("All Levels");
    setSelSectorId(null);
    setMapZoom(1);
  }

  function handleSelectRisk(risk: string) {
    setSelRisk(risk);
    setSelSectorId(null);
  }

  return (
    <div
      className="w-full h-screen flex flex-col overflow-hidden bg-background text-foreground"
      style={{ fontFamily: "'Rajdhani','Inter',sans-serif" }}
    >
      {showStartupPanel && (
        <StartupPanel
          elapsedSeconds={startupElapsedSeconds}
          apiError={apiError}
          onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
        />
      )}

      <DashboardHeader apiUrl={API_BASE_URL} />

      <div className="flex-1 grid grid-cols-[220px_1fr_310px] min-h-0 overflow-hidden">
        <FilterSidebar
          summary={summary}
          sectors={sectorRows}
          districts={districts}
          districtCounts={districtCounts}
          selDistrict={selDistrict}
          selRisk={selRisk}
          selSectorId={selSectorId}
          sectorsForFilter={sectorsForFilter}
          onReset={resetFilters}
          onSelectDistrict={selectDistrict}
          onSelectRisk={handleSelectRisk}
          onSelectSector={selectSector}
          onClearSector={() => setSelSectorId(null)}
        />

        <div className="flex flex-col overflow-hidden">
          <MapPanel
            mapViewBox={mapViewBox}
            filteredMapFeatures={filteredMapFeatures}
            activeMapFeature={activeMapFeature}
            activeSector={activeSector}
            selSectorId={selSectorId}
            hovSectorId={hovSectorId}
            mapZoom={mapZoom}
            onZoomIn={() => setMapZoom((zoom) => clamp(zoom + MAP_ZOOM_STEP, MAP_ZOOM_MIN, MAP_ZOOM_MAX))}
            onZoomOut={() => setMapZoom((zoom) => clamp(zoom - MAP_ZOOM_STEP, MAP_ZOOM_MIN, MAP_ZOOM_MAX))}
            onHoverSector={setHovSectorId}
            onSelectSector={selectSector}
            onClearSelection={() => setSelSectorId(null)}
          />

          <div className="px-6 pb-4">
            <SectorDetailCard
              activeSector={activeSector}
              filteredMapFeatures={filteredMapFeatures}
              loading={loading}
            />
          </div>
        </div>

        <RankingSidebar
          filteredRankings={filteredRankings}
          selSectorId={selSectorId}
          totalPopulation={totalPopulation}
          onSelectSector={selectSector}
        />
      </div>

      <BottomFooter
        summary={summary}
        sectorRowsLength={sectorRows.length}
        infoTab={infoTab}
        onTabChange={setInfoTab}
      />
    </div>
  );
}
