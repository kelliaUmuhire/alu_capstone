import { Eye, MapPin, TrendingUp, Users } from "lucide-react";
import type { SectorAssessment } from "../types";
import { formatScoreOutOf100, riskStyle, scoreBarColor } from "../utils";

type RankingSidebarProps = {
  filteredRankings: SectorAssessment[];
  selSectorId: string | null;
  totalPopulation: number;
  onSelectSector: (sector: SectorAssessment) => void;
};

export function RankingSidebar({ filteredRankings, selSectorId, totalPopulation, onSelectSector }: RankingSidebarProps) {
  return (
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
                  onClick={() => onSelectSector(sector)}
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
                        <span className={`text-[10px] font-mono shrink-0 ${style.text}`}>
                          {sector.hybrid_vulnerability_class}
                        </span>
                      </div>
                      <div className="h-[2px] bg-secondary rounded-full overflow-hidden mb-1.5">
                        <div
                          className={`h-full rounded-full ${scoreBarColor(sector.hybrid_vulnerability_class)}`}
                          style={{ width: `${Math.min(100, sector.hybrid_vulnerability_score * 100)}%` }}
                        />
                      </div>
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
  );
}
