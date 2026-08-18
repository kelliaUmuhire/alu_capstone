import { Activity, Clock, Shield } from "lucide-react";
import { API_BASE_URL } from "../data";

type DashboardHeaderProps = {
  apiUrl: string;
};

export function DashboardHeader({ apiUrl }: DashboardHeaderProps) {
  return (
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
        <div className="flex items-center gap-1.5 px-2 py-1 border rounded shrink-0 bg-emerald-500/10 border-emerald-500/25">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-emerald-400" />
          <span className="text-[10px] font-mono tracking-widest text-emerald-400">SECTOR</span>
        </div>
      </div>

      <div
        className="flex items-center gap-5 text-[10px] text-muted-foreground shrink-0"
        style={{ fontFamily: "'JetBrains Mono',monospace" }}
      >
        <span className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 shrink-0" />
          API:
          <a
            href={`${apiUrl}/docs`}
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
  );
}

export { API_BASE_URL };
