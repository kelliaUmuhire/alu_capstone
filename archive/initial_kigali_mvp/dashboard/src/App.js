import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;
const classLabels = ["All", "High", "Medium", "Low"];
const featureNames = {
  ndvi_real: "NDVI",
  ndbi_real: "NDBI",
  mndwi_real: "MNDWI",
  elevation_m_real: "Elevation",
  slope_degrees_real: "Slope",
  flood_zone_overlap_real: "Flood overlap",
  building_density_per_ha_real: "Building density",
  road_density_m_per_ha_real: "Road density",
};
const riskColors = {
  High: "#b73b2e",
  Medium: "#b77916",
  Low: "#2f7d42",
};

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function riskClass(row) {
  return row.predicted_vulnerability_class || row.proxy_vulnerability_class;
}

async function fetchJson(paths) {
  for (const path of paths) {
    const response = await fetch(path);
    if (response.ok) return response.json();
  }
  throw new Error("Could not load dashboard data.");
}

function Metric({ label, value, detail }) {
  return h("section", { className: "metric" }, [
    h("span", { key: "label" }, label),
    h("strong", { key: "value" }, value),
    h("small", { key: "detail" }, detail),
  ]);
}

function StatusPill({ value }) {
  return h("span", { className: `pill ${String(value).toLowerCase()}` }, value);
}

function SettlementMap({ rows, selectedId, onSelect }) {
  const validRows = rows.filter(
    (row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
  );
  if (!validRows.length) {
    return h("section", { className: "map-panel", "aria-label": "Settlement map" }, [
      h("div", { className: "section-header", key: "map-header" }, [
        h("div", { key: "copy" }, [
          h("h2", { key: "title" }, "Assessment area map"),
          h("p", { key: "subtitle" }, "Loading settlement points"),
        ]),
      ]),
      h("div", { className: "map-wrap loading-map", key: "map-wrap" }, "Loading map"),
    ]);
  }
  const lats = validRows.map((row) => Number(row.latitude));
  const lons = validRows.map((row) => Number(row.longitude));
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  const points = validRows.map((row) => {
    const x = 50 + ((Number(row.longitude) - minLon) / lonSpan) * 900;
    const y = 340 - ((Number(row.latitude) - minLat) / latSpan) * 280;
    return { ...row, x, y, klass: riskClass(row) };
  });

  return h("section", { className: "map-panel", "aria-label": "Settlement map" }, [
    h("div", { className: "section-header", key: "map-header" }, [
      h("div", { key: "copy" }, [
        h("h2", { key: "title" }, "Assessment area map"),
        h(
          "p",
          { key: "subtitle" },
          `${validRows.length} settlement points across Kigali districts`
        ),
      ]),
      h("div", { className: "map-legend", key: "legend" }, [
        ...["High", "Medium", "Low"].map((label) =>
          h("span", { key: label }, [
            h("i", { style: { background: riskColors[label] }, key: "dot" }),
            label,
          ])
        ),
      ]),
    ]),
    h("div", { className: "map-wrap", key: "map-wrap" }, [
      h(
        "svg",
        {
          viewBox: "0 0 1000 390",
          role: "img",
          "aria-label": "Simplified map of settlement vulnerability points",
        },
        [
          h("rect", {
            key: "background",
            x: 25,
            y: 30,
            width: 950,
            height: 330,
            rx: 8,
            className: "map-bg",
          }),
          ...[0, 1, 2, 3].map((index) =>
            h("line", {
              key: `v-${index}`,
              x1: 90 + index * 220,
              x2: 90 + index * 220,
              y1: 55,
              y2: 335,
              className: "map-grid",
            })
          ),
          ...[0, 1, 2].map((index) =>
            h("line", {
              key: `h-${index}`,
              x1: 55,
              x2: 945,
              y1: 110 + index * 85,
              y2: 110 + index * 85,
              className: "map-grid",
            })
          ),
          h("text", { key: "north", x: 52, y: 58, className: "map-label" }, "N"),
          h("text", { key: "west", x: 44, y: 355, className: "map-axis" }, "west"),
          h("text", { key: "east", x: 902, y: 355, className: "map-axis" }, "east"),
          ...points.map((row) => {
            const active = row.settlement_id === selectedId;
            return h(
              "circle",
              {
                key: row.settlement_id,
                "data-testid": `map-point-${row.settlement_id}`,
                cx: row.x,
                cy: row.y,
                r: active ? 8 : 4.5,
                fill: riskColors[row.klass] || "#607068",
                className: active ? "map-point active-point" : "map-point",
                onClick: () => onSelect(row.settlement_id),
              },
              [h("title", { key: "title" }, `${row.name} - ${row.klass}`)]
            );
          }),
        ]
      ),
    ]),
  ]);
}

function App() {
  const [rankings, setRankings] = useState([]);
  const [importance, setImportance] = useState([]);
  const [district, setDistrict] = useState("All");
  const [risk, setRisk] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const [rankingData, importanceData] = await Promise.all([
          fetchJson([
            "/settlement_vulnerability_rankings.json",
            "/public/settlement_vulnerability_rankings.json",
          ]),
          fetchJson(["/feature_importance.json", "/public/feature_importance.json"]),
        ]);
        setRankings(rankingData);
        setImportance(importanceData);
        setSelectedId(rankingData[0]?.settlement_id ?? null);
      } catch (error) {
        setLoadError(error.message);
      }
    }
    loadData();
  }, []);

  const districts = useMemo(() => {
    return ["All", ...new Set(rankings.map((row) => row.district).sort())];
  }, [rankings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rankings
      .filter((row) => district === "All" || row.district === district)
      .filter((row) => risk === "All" || riskClass(row) === risk)
      .filter((row) => {
        if (!q) return true;
        return [row.name, row.settlement_id, row.district].some((value) =>
          String(value).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => Number(a.vulnerability_rank) - Number(b.vulnerability_rank));
  }, [rankings, district, risk, query]);

  const selected = useMemo(() => {
    return (
      filtered.find((row) => row.settlement_id === selectedId) ||
      filtered[0] ||
      rankings[0]
    );
  }, [filtered, rankings, selectedId]);

  const summary = useMemo(() => {
    const high = rankings.filter((row) => riskClass(row) === "High").length;
    const topScore = rankings[0]?.proxy_vulnerability_score ?? 0;
    const avgScore =
      rankings.reduce(
        (total, row) => total + Number(row.proxy_vulnerability_score || 0),
        0
      ) / Math.max(rankings.length, 1);
    return { high, topScore, avgScore };
  }, [rankings]);

  if (loadError) {
    return h("main", { className: "app error-state" }, [
      h("h1", { key: "title" }, "Kigali Settlement Vulnerability MVP"),
      h("p", { key: "error" }, loadError),
    ]);
  }

  return h("main", { className: "app" }, [
    h("header", { className: "topbar", key: "topbar" }, [
      h("div", { key: "title-wrap" }, [
        h("p", { className: "eyebrow", key: "eyebrow" }, "Decision support MVP"),
        h("h1", { key: "title" }, "Kigali Settlement Vulnerability"),
      ]),
      h(
        "p",
        { className: "caveat", key: "caveat" },
        "Proxy labels for prototype use only"
      ),
    ]),

    h("section", { className: "metrics-grid", key: "metrics" }, [
      h(Metric, {
        key: "settlements",
        label: "Settlements",
        value: rankings.length || "...",
        detail: "ranked records",
      }),
      h(Metric, {
        key: "high",
        label: "High risk",
        value: summary.high || "...",
        detail: "predicted class",
      }),
      h(Metric, {
        key: "top-score",
        label: "Top score",
        value: formatNumber(summary.topScore),
        detail: "proxy index",
      }),
      h(Metric, {
        key: "average",
        label: "Average score",
        value: formatNumber(summary.avgScore),
        detail: "all settlements",
      }),
    ]),

    h(SettlementMap, {
      key: "map",
      rows: filtered.length ? filtered : rankings,
      selectedId: selected?.settlement_id,
      onSelect: setSelectedId,
    }),

    h("section", { className: "workspace", key: "workspace" }, [
      h("aside", { className: "filters", key: "filters" }, [
        h("label", { key: "district" }, [
          "District",
          h(
            "select",
            {
              key: "district-select",
              value: district,
              onChange: (event) => setDistrict(event.target.value),
            },
            districts.map((value) =>
              h("option", { key: value, value }, value)
            )
          ),
        ]),
        h("label", { key: "risk" }, [
          "Vulnerability class",
          h(
            "select",
            {
              key: "risk-select",
              value: risk,
              onChange: (event) => setRisk(event.target.value),
            },
            classLabels.map((value) =>
              h("option", { key: value, value }, value)
            )
          ),
        ]),
        h("label", { key: "search" }, [
          "Search",
          h("input", {
            key: "search-input",
            type: "search",
            value: query,
            onChange: (event) => setQuery(event.target.value),
            placeholder: "Settlement, ID, district",
          }),
        ]),
        h("div", { className: "feature-panel", key: "feature-panel" }, [
          h("h2", { key: "drivers-title" }, "Model drivers"),
          ...importance.map((item) =>
            h("div", { className: "importance-row", key: item.feature }, [
              h(
                "span",
                { key: "name" },
                featureNames[item.feature] || item.feature.replaceAll("_", " ")
              ),
              h("div", { className: "bar-track", key: "track" }, [
                h("div", {
                  className: "bar-fill",
                  key: "fill",
                  style: {
                    width: `${Math.max(4, Number(item.importance) * 100)}%`,
                  },
                }),
              ]),
              h(
                "strong",
                { key: "value" },
                `${formatNumber(Number(item.importance) * 100, 0)}%`
              ),
            ])
          ),
        ]),
      ]),

      h("section", { className: "results", key: "results" }, [
        h("div", { className: "section-header", key: "section-header" }, [
          h("div", { key: "header-copy" }, [
            h("h2", { key: "title" }, "Ranked settlements"),
            h("p", { key: "count" }, `${filtered.length} visible records`),
          ]),
        ]),
        h("div", { className: "table-wrap", key: "table-wrap" }, [
          h("table", { key: "table" }, [
            h("thead", { key: "thead" }, [
              h("tr", {}, [
                h("th", { key: "rank" }, "Rank"),
                h("th", { key: "settlement" }, "Settlement"),
                h("th", { key: "district" }, "District"),
                h("th", { key: "class" }, "Class"),
                h("th", { key: "score" }, "Score"),
                h("th", { key: "confidence" }, "Confidence"),
              ]),
            ]),
            h(
              "tbody",
              { key: "tbody" },
              filtered.slice(0, 40).map((row) => {
                const active = selected?.settlement_id === row.settlement_id;
                const klass = riskClass(row);
                const confidence = Math.max(
                  Number(row.probability_high || 0),
                  Number(row.probability_medium || 0),
                  Number(row.probability_low || 0)
                );
                return h(
                  "tr",
                  {
                    key: row.settlement_id,
                    className: active ? "active-row" : "",
                    onClick: () => setSelectedId(row.settlement_id),
                  },
                  [
                    h("td", { key: "rank" }, row.vulnerability_rank),
                    h("td", { key: "settlement" }, [
                      h("strong", { key: "name" }, row.name),
                      h("span", { key: "id" }, row.settlement_id),
                    ]),
                    h("td", { key: "district" }, row.district),
                    h("td", { key: "class" }, h(StatusPill, { value: klass })),
                    h(
                      "td",
                      { key: "score" },
                      formatNumber(row.proxy_vulnerability_score)
                    ),
                    h(
                      "td",
                      { key: "confidence" },
                      `${formatNumber(confidence * 100, 0)}%`
                    ),
                  ]
                );
              })
            ),
          ]),
        ]),
      ]),

      h("aside", { className: "detail", key: "detail" }, [
        selected
          ? h(React.Fragment, {}, [
              h("p", { className: "eyebrow", key: "eyebrow" }, "Selected settlement"),
              h("h2", { key: "name" }, selected.name),
              h(StatusPill, { key: "pill", value: riskClass(selected) }),
              h("dl", { key: "meta" }, [
                h("div", { key: "rank" }, [
                  h("dt", {}, "Rank"),
                  h("dd", {}, `#${selected.vulnerability_rank}`),
                ]),
                h("div", { key: "score" }, [
                  h("dt", {}, "Score"),
                  h("dd", {}, formatNumber(selected.proxy_vulnerability_score)),
                ]),
                h("div", { key: "district" }, [
                  h("dt", {}, "District"),
                  h("dd", {}, selected.district),
                ]),
                h("div", { key: "area" }, [
                  h("dt", {}, "Area"),
                  h("dd", {}, `${formatNumber(selected.area_hectares)} ha`),
                ]),
              ]),
              h("div", { className: "signals", key: "signals" }, [
                h("h3", { key: "title" }, "Physical signals"),
                h("span", { key: "ndvi" }, `NDVI ${formatNumber(selected.ndvi_real, 2)}`),
                h("span", { key: "ndbi" }, `NDBI ${formatNumber(selected.ndbi_real, 2)}`),
                h(
                  "span",
                  { key: "slope" },
                  `Slope ${formatNumber(selected.slope_degrees_real)} deg`
                ),
                h(
                  "span",
                  { key: "buildings" },
                  `Buildings ${formatNumber(selected.building_density_per_ha_real)} / ha`
                ),
                h(
                  "span",
                  { key: "roads" },
                  `Roads ${formatNumber(selected.road_density_m_per_ha_real, 0)} m / ha`
                ),
              ]),
            ])
          : null,
      ]),
    ]),
  ]);
}

createRoot(document.getElementById("root")).render(h(App));
