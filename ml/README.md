# XSpamShield ML Pipeline

This directory contains the preprocessing, training, evaluation, and export pipeline for the XSpamShield spam classifier.

## Commands

```bash
uv sync
uv run build-vocab --input ../artifacts/sample-data/sample_export.json
uv run prepare-dataset --input ../artifacts/sample-data/sample_export.json
uv run train-model --dataset data/processed/dataset.jsonl
uv run evaluate-model --dataset data/processed/dataset.jsonl --checkpoint outputs/checkpoints/best.pt
uv run export-onnx --checkpoint outputs/checkpoints/best.pt
uv run convert-tfjs --onnx outputs/onnx/spam_model.onnx --output-dir outputs/tfjs_model
uv run compare-backends --dataset data/processed/dataset.jsonl --checkpoint outputs/checkpoints/best.pt --onnx outputs/onnx/spam_model.onnx
```

## Data flow

1. Import one or more exported JSON files.
2. Read `reply.cleaned_pinyin` from the export and only fall back to local normalization when older exports do not contain that field.
3. Build `data/vocab.txt`.
4. Emit `data/processed/dataset.jsonl` with weighted labels and reply-only model tokens.
5. Train the TextCNN model and save checkpoints.
6. Export ONNX and convert to TF.js.

## Notes

- Manual labels are weighted higher than auto labels during training.
- The model input is reply-only: `['[CLS]', ...cleaned_pinyin.split(), '[SEP]']`, padded to the configured sequence length.
- `convert-tfjs` shells out to `onnx2tf` and `tensorflowjs_converter`; install the `export` extra when you need that path.
- `convert-tfjs` also copies `data/vocab.txt` into the TF.js output directory as `vocab.txt` so the extension can reuse the trained vocabulary online.
