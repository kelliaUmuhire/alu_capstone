import { Activity, AlertTriangle, Database, MapPin, Shield, TrendingUp, Zap } from "lucide-react";
import type { DashboardSummary } from "../types";
import { formatPercent, formatScoreOutOf100 } from "../utils";

type BottomFooterProps = {
  summary: DashboardSummary | undefined;
  sectorRowsLength: number;
  infoTab: "model" | "source" | "caveat";
  onTabChange: (tab: "model" | "source" | "caveat") => void;
};

export function BottomFooter({ summary, sectorRowsLength, infoTab, onTabChange }: BottomFooterProps) {
  return (
    <footer className="shrink-0 border-t border-border bg-card">
      <div className="flex border-b border-border">
        {[
          { label: "Sectors Assessed", value: String(summary?.sector_count ?? sectorRowsLength), icon: MapPin, color: "text-cyan-400" },
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
              onClick={() => onTabChange(tab)}
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
  );
}
