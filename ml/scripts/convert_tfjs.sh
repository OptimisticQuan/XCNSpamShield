#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

uv run export-onnx --checkpoint outputs/checkpoints/best.pt
uv run convert-tfjs --onnx outputs/onnx/spam_model.onnx --output-dir outputs/tfjs_model
