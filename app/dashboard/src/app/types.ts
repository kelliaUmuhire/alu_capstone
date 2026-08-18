export type Coord = [number, number];

export type GadmFeature = {
  type: "Feature";
  properties: {
    GID_3: string;
    NAME_1: string;
    NAME_2: string;
    NAME_3: string;
  };
  geometry: {
    type: "MultiPolygon";
    coordinates: Coord[][][];
  };
};

export type SectorAssessment = {
  sector_id: string;
  sector_name: string;
  district: string;
  proxy_class: string;
  proxy_score: number;
  proxy_rank: number;
  probability_low: number;
  probability_medium: number;
  probability_high: number;
  primary_model: string;
  model_predicted_class: string;
  model_probability: number;
  model_vulnerability_score: number;
  model_priority_rank: number;
  model_agrees_with_proxy_label: boolean;
  hybrid_model_weight: number;
  hybrid_indicator_weight: number;
  hybrid_model_contribution: number;
  hybrid_indicator_contribution: number;
  hybrid_vulnerability_score: number;
  hybrid_vulnerability_class: string;
  hybrid_priority_rank: number;
  population_total?: number | null;
  population_urban?: number | null;
  population_rural?: number | null;
  urban_share?: number | null;
  rural_share?: number | null;
  population_density_per_km2?: number | null;
  population_male?: number | null;
  population_female?: number | null;
  total_age_dependency_ratio?: number | null;
  district_age_share_0_14?: number | null;
  district_age_share_15_64?: number | null;
  district_age_share_65_plus?: number | null;
  component_density_pressure?: number | null;
  component_rurality_context?: number | null;
  component_district_age_dependency_context?: number | null;
  label_limitations?: string | null;
};

export type DashboardSummary = {
  sector_count: number;
  district_count: number;
  training_row_count: number;
  independent_sector_count: number;
  class_counts: Record<string, number>;
  indicator_class_counts: Record<string, number>;
  predicted_class_counts: Record<string, number>;
  agreement_count: number;
  average_proxy_score: number;
  average_hybrid_score: number;
  population_total: number | null;
  best_model?: {
    model: string;
    macro_f1: number;
    balanced_accuracy: number;
    accuracy: number;
  };
  caveat: string;
};

export type DashboardPayload = {
  summary: DashboardSummary;
  districts: string[];
  classes: string[];
  rankings: SectorAssessment[];
  model_performance: Array<Record<string, unknown>>;
  feature_importance: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
};

export type SectorListPayload = {
  total: number;
  items: SectorAssessment[];
};

export type MapFeature = {
  id: string;
  name: string;
  district: string;
  path: string;
  center: Coord;
  assessment?: SectorAssessment;
};

export type ProvinceFeature = {
  name: string;
  path: string;
  center: Coord;
  color: string;
};

export type InfoTab = "model" | "source" | "caveat";
