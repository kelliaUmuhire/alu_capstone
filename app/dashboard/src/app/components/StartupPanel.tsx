import { AlertTriangle } from "lucide-react";

type StartupPanelProps = {
  elapsedSeconds: number;
  apiError: string | null;
  onRetry: () => void;
};

export function StartupPanel({ elapsedSeconds, apiError, onRetry }: StartupPanelProps) {
  const isLongWake = elapsedSeconds >= 20;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/96 px-5 backdrop-blur-sm">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(#00C8E8 1px,transparent 1px),linear-gradient(90deg,#00C8E8 1px,transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />
      <div className="relative w-full max-w-[560px] rounded-lg border border-cyan-400/25 bg-card/95 p-7 shadow-[0_0_70px_rgba(0,200,232,0.12)]">
        <div className="flex items-center gap-5">
          <div className="relative h-24 w-24 shrink-0">
            <div className="absolute inset-0 rounded-full border border-cyan-300/25" />
            <div className="absolute inset-2 rounded-full border border-cyan-300/35 animate-ping" />
            <div className="absolute inset-4 rounded-full border border-cyan-300/40" />
            <div className="absolute inset-[34px] rounded-full bg-cyan-300 shadow-[0_0_28px_rgba(34,211,238,0.8)]" />
            <div className="absolute left-1/2 top-1/2 h-[1px] w-10 origin-left animate-spin bg-cyan-300/75" />
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-300 animate-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300">
                API connection
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-wide text-white">Starting assessment API</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The dashboard is waiting for the Render backend to wake up after inactivity. This can take around
              50 seconds on the first request.
            </p>
            <div className="mt-4 flex items-center gap-3 font-mono text-xs">
              <span className="rounded border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-cyan-200">
                {elapsedSeconds}s elapsed
              </span>
              <span className="text-muted-foreground/85">
                {isLongWake ? "Still waking the server..." : "Connecting to FastAPI..."}
              </span>
            </div>
          </div>
        </div>

        {apiError && (
          <div className="mt-5 rounded border border-red-500/30 bg-red-500/10 p-3">
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <p className="text-xs leading-relaxed text-red-100/85">{apiError}</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="rounded border border-red-300/30 bg-red-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-red-100 hover:bg-red-500/25"
            >
              Retry connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
