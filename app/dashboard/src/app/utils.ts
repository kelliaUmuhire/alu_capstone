export function riskStyle(level: string) {
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

export function scoreBarColor(level: string) {
  if (level === "High") return "bg-red-500";
  if (level === "Medium") return "bg-orange-500";
  if (level === "Low") return "bg-emerald-500";
  return "bg-cyan-500";
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatScoreOutOf100(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)} / 100`;
}

export function formatContribution(value: number | null | undefined, weight: number) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * weight * 100).toFixed(1)} / 100`;
}

export function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load dashboard data";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
