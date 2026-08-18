import { ZoomIn, ZoomOut } from "lucide-react";
import { PROVINCE_FEATURES, SVG_W, clamp } from "../data";
import type { MapFeature, SectorAssessment } from "../types";
import { riskStyle } from "../utils";

type MapPanelProps = {
  mapViewBox: string;
  filteredMapFeatures: MapFeature[];
  activeMapFeature: MapFeature | null;
  activeSector: SectorAssessment | null;
  selSectorId: string | null;
  hovSectorId: string | null;
  mapZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onHoverSector: (sectorId: string | null) => void;
  onSelectSector: (sector: SectorAssessment) => void;
  onClearSelection: () => void;
};

export function MapPanel({
  mapViewBox,
  filteredMapFeatures,
  activeMapFeature,
  activeSector,
  selSectorId,
  hovSectorId,
  mapZoom,
  onZoomIn,
  onZoomOut,
  onHoverSector,
  onSelectSector,
  onClearSelection,
}: MapPanelProps) {
  return (
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
              onClick={onZoomOut}
              disabled={mapZoom <= 1}
              className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-cyan-300 hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={onZoomIn}
              disabled={mapZoom >= 3}
              className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-cyan-300 hover:bg-white/[0.05] disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <svg
            viewBox={mapViewBox}
            className="w-full max-w-[760px]"
            onMouseLeave={() => onHoverSector(null)}
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
              const dimmed = !!selSectorId && !isSelected;

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
                      if (assessment) onSelectSector(assessment);
                    }}
                    onMouseEnter={() => onHoverSector(sector.id)}
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
                    <circle cx={sector.center[0]} cy={sector.center[1]} r="2.2" fill="#ef4444" opacity="0.96" />
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
                    <circle cx={sector.center[0]} cy={sector.center[1]} r="6" fill="#ef4444" opacity="0.14">
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
      </div>
    </main>
  );
}
