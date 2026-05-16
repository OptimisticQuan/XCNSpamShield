# XSpamShield ML Pipeline

This directory contains the preprocessing, training, evaluation, and export pipeline for the XSpamShield spam classifier.

## Commands

```bash
uv sync
uv run build-vocab
uv run prepare-dataset
uv run train-model --dataset data/processed/dataset.jsonl
uv run evaluate-model --dataset data/processed/dataset.jsonl --checkpoint outputs/checkpoints/best.pt
uv run export-onnx --checkpoint outputs/checkpoints/best.pt
uv run convert-tfjs --onnx outputs/onnx/spam_model.onnx --output-dir outputs/tfjs_model
uv run compare-backends --dataset data/processed/dataset.jsonl --checkpoint outputs/checkpoints/best.pt --onnx outputs/onnx/spam_model.onnx
```

## Data flow

1. Read all exported JSON files under `data/raw/` by default.
2. Merge every reply list entry into one training set and require `reply.cleaned_pinyin` to already exist.
3. Build `data/vocab.txt`.
4. Emit `data/processed/dataset.jsonl` with weighted labels and reply-only model tokens.
5. Train the TextCNN model and save checkpoints.
6. Export ONNX and convert to TF.js.

## Notes

- Manual labels are weighted higher than auto labels during training.
- The model input is reply-only: `['[CLS]', ...cleaned_pinyin.split(), '[SEP]']`, padded to the configured sequence length.
- The Python side no longer rebuilds normalization locally. If any raw export is missing `cleaned_pinyin`, re-export it from the extension before training.
- `convert-tfjs` shells out to `onnx2tf` and `tensorflowjs_converter`; install the `export` extra when you need that path.
- `convert-tfjs` also copies `data/vocab.txt` into the TF.js output directory as `vocab.txt` so the extension can reuse the trained vocabulary online.
