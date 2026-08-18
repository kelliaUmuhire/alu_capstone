import { Filter } from "lucide-react";
import { CLASS_ORDER, RISK_LEVELS } from "../data";
import type { DashboardSummary, SectorAssessment } from "../types";
import { riskStyle } from "../utils";

type FilterSidebarProps = {
  summary: DashboardSummary | undefined;
  sectors: SectorAssessment[];
  districts: string[];
  districtCounts: Map<string, number>;
  selDistrict: string;
  selRisk: string;
  selSectorId: string | null;
  sectorsForFilter: SectorAssessment[];
  onReset: () => void;
  onSelectDistrict: (district: string) => void;
  onSelectRisk: (risk: string) => void;
  onSelectSector: (sector: SectorAssessment) => void;
  onClearSector: () => void;
};

export function FilterSidebar({
  summary,
  sectors,
  districts,
  districtCounts,
  selDistrict,
  selRisk,
  selSectorId,
  sectorsForFilter,
  onReset,
  onSelectDistrict,
  onSelectRisk,
  onSelectSector,
  onClearSector,
}: FilterSidebarProps) {
  return (
    <aside className="border-r border-border bg-card flex flex-col overflow-y-auto p-5 gap-4 scrollbar-none">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-cyan-400/85" />
          <span className="text-[10px] font-mono text-cyan-400/85 tracking-[0.18em] uppercase">Filters</span>
        </span>
        <button
          onClick={onReset}
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
                onClick={() => onSelectRisk(risk)}
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
            onClick={() => onSelectDistrict("All Districts")}
            className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-semibold tracking-wide transition-all flex items-center justify-between ${
              selDistrict === "All Districts"
                ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
            }`}
          >
            All Districts
            <span className="text-[10px] font-mono opacity-70">{summary?.sector_count ?? sectors.length}</span>
          </button>

          {districts.map((district) => {
            const active = selDistrict === district;
            return (
              <button
                key={district}
                onClick={() => onSelectDistrict(district)}
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
            onClick={onClearSector}
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
                onClick={() => onSelectSector(sector)}
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
                <span className="text-[10px] font-mono text-muted-foreground/65">{summary?.class_counts?.[label] ?? 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
