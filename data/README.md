# Data directories

- `raw/` contains unchanged source files supplied for the project.
- `processed/` contains lossless joins, audits, and sector/subunit feature tables.
- `labels/` contains the rule-based proxy labels and methodology records.
- `model_outputs/` contains assessments, evaluation tables, and generated plots.

Do not edit source observations in `raw/`. Rebuild derived artifacts with the
scripts in `scripts/` so that provenance and audit outputs remain reproducible.
