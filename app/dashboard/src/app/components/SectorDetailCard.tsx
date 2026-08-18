import { Activity, AlertTriangle, MapPin, Shield, TrendingUp, Users, Zap } from "lucide-react";
import type { DashboardSummary, SectorAssessment } from "../types";
import { formatContribution, formatNumber, formatPercent, formatScoreOutOf100, riskStyle } from "../utils";

type SectorDetailCardProps = {
  activeSector: SectorAssessment | null;
  filteredMapFeatures: { length: number };
  loading: boolean;
};

export function SectorDetailCard({ activeSector, filteredMapFeatures, loading }: SectorDetailCardProps) {
  return (
    <div className={`transition-all duration-200 w-full max-w-[760px]`}>
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

            <div className="flex items-center gap-4 mt-1 text-[9px] font-mono text-muted-foreground/80">
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
                    <div className="text-[8px] font-mono text-muted-foreground/80 uppercase tracking-widest truncate">{item.label}</div>
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
                <div className="mt-2 text-[9px] leading-snug text-muted-foreground/80">{activeSector.label_limitations}</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[9px] font-mono text-muted-foreground tracking-wider uppercase mb-0.5">
                {loading ? "Loading FastAPI outputs" : "Sector map ready"}
              </div>
              <div className="text-sm font-bold text-white tracking-wide">{filteredMapFeatures.length} sectors in current view</div>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground/80">Click a sector for details</div>
          </div>
        )}
      </div>
    </div>
  );
}
