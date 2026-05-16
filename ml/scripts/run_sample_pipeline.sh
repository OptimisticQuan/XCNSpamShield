#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

uv run build-vocab --input ../artifacts/sample-data/sample_export.json
uv run prepare-dataset --input ../artifacts/sample-data/sample_export.json
uv run train-model --dataset data/processed/dataset.jsonl
