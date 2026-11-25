import { AlertTriangle, Database, MapPin, Shield } from "lucide-react";

const sections = [
  {
    title: "About this platform",
    icon: Shield,
    content: (
      <p>
        The Rwanda Informal Settlement Vulnerability Assessment System is a research and planning prototype developed to support the assessment of vulnerability across selected administrative sectors in Rwanda. It is intended primarily for urban planners, researchers and development organisations. It is not an official government poverty classification system or a replacement for field assessments.
      </p>
    ),
  },
  {
    title: "Data used by the platform",
    icon: Database,
    content: (
      <>
        <p>These datasets are combined to produce sector-level vulnerability estimates:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Satellite-derived environmental and geographical features from Sentinel-2.</li>
          <li>Aggregated demographic and population information from National Institute of Statistics of Rwanda census tables.</li>
          <li>Administrative boundary data from GADM.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Individual and household information",
    icon: MapPin,
    content: (
      <>
        <p>
          The documented research implementation uses sector-level information rather than individual household vulnerability profiles. The dashboard does not document a feature for residents to submit household information or personal research responses.
        </p>
      </>
    ),
  },
  {
    title: "How the results should be interpreted",
    icon: AlertTriangle,
    content: (
      <p>
        The platform produces estimates based on available indicators and machine-learning predictions. These estimates are not official Ubudehe classifications and should not be interpreted as definitive descriptions of every resident within a sector. The results are intended to help identify areas that may require further investigation.
      </p>
    ),
  },
];

export function PrivacyPage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-cyan-400">
            Rwanda Informal Settlement Vulnerability Assessment System
          </p>
          <h2 className="text-3xl font-bold tracking-wide text-white sm:text-4xl">
            Privacy &amp; Responsible Use
          </h2>
        </div>

        <div className="space-y-4">
          {sections.map(({ title, icon: Icon, content }) => (
            <section key={title} className="rounded border border-border bg-card p-5 sm:p-6">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-cyan-200">
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-cyan-400" />
                {title}
              </h3>
              <div className="text-sm leading-7 text-muted-foreground">{content}</div>
            </section>
          ))}

          <section className="rounded border border-border bg-card p-5 sm:p-6">
            <h3 className="mb-3 text-lg font-semibold text-cyan-200">Responsible use</h3>
            <p className="text-sm leading-7 text-muted-foreground">
              The vulnerability rankings should not be used as the sole basis for allocating public resources or making decisions about individual households. Further verification, local knowledge and human judgement should be considered before consequential planning decisions are made.
            </p>
          </section>

          <section className="rounded border border-border bg-card p-5 sm:p-6">
            <h3 className="mb-3 text-lg font-semibold text-cyan-200">Limitations</h3>
            <p className="text-sm leading-7 text-muted-foreground">
              The current prototype covers four districts and uses a census-derived proxy indicator because verified household-level vulnerability labels were unavailable. The results should therefore be interpreted as preliminary planning estimates.
            </p>
          </section>

          <section className="rounded border border-border bg-card p-5 sm:p-6">
            <h3 className="mb-3 text-lg font-semibold text-cyan-200">Questions and enquiries</h3>
            <p className="text-sm leading-7 text-muted-foreground">
              For questions about this research project or the interpretation of its results, contact:
            </p>
            <p className="mt-2 text-sm font-medium text-cyan-200">
              k.umuhire@alustudent.com
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
