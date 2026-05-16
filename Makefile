PNPM := pnpm --dir extension
UV := cd ml && uv run

.PHONY: extension-install extension-build extension-test extension-typecheck ml-sync ml-test ml-train ml-export copy-model all

extension-install:
	$(PNPM) install

extension-build:
	$(PNPM) build

extension-test:
	$(PNPM) test --run

extension-typecheck:
	$(PNPM) typecheck

ml-sync:
	cd ml && uv sync

ml-test:
	cd ml && uv run pytest

ml-train:
	$(UV) train-model --dataset data/processed/dataset.jsonl

ml-export:
	$(UV) export-onnx --checkpoint outputs/checkpoints/best.pt
	$(UV) convert-tfjs --onnx outputs/onnx/spam_model.onnx --output-dir outputs/tfjs_model

copy-model:
	node scripts/copy-model.mjs --source ml/outputs/tfjs_model --target extension/public/tfjs_model

all: extension-build ml-test
