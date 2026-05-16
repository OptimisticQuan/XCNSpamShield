# XSpamShield

XSpamShield is a two-part project for collecting, labeling, training, and blocking spam replies on X and Twitter.

## Workspace layout

- `extension/`: Manifest V3 browser extension built with TypeScript and Vite.
- `ml/`: Python training and export pipeline managed with `uv`.
- `artifacts/`: sample datasets and exported model artifacts.
- `scripts/`: cross-project helper scripts.

## Quick start

### Extension

```bash
pnpm --dir extension install
pnpm --dir extension dev
pnpm --dir extension build
```

Load `extension/dist` as an unpacked extension after a build.

### ML pipeline

```bash
cd ml
uv sync
uv run build-vocab --input ../artifacts/sample-data/sample_export.json
uv run prepare-dataset --input ../artifacts/sample-data/sample_export.json
uv run train-model --dataset data/processed/dataset.jsonl
uv run export-onnx --checkpoint outputs/checkpoints/best.pt
uv run convert-tfjs --onnx outputs/onnx/spam_model.onnx --output-dir outputs/tfjs_model
```

`convert-tfjs` also copies `data/vocab.txt` into `outputs/tfjs_model/vocab.txt`, and the extension will use that vocabulary for online inference when it is present.

### Shared workflow

```bash
node scripts/copy-model.mjs --source ml/outputs/tfjs_model --target extension/public/tfjs_model
```

## Current scope

- Popup toggle, extraction, local review, delete, relabel, export.
- Content-script heuristics, TF.js model loading boundary, reply collapse UI, and inline spam toggle button.
- Training dataset preparation, vocabulary building, TextCNN training, ONNX export, TF.js conversion wrapper, and backend comparison script.
- Reply preprocessing now combines `author_name:original_text`, normalizes common obfuscation symbols including digit, Greek, and Cyrillic lookalikes, strips punctuation and zero-width characters, preserves emoji, and removes non-pinyin Latin fragments.
- The classifier now uses reply-only `cleaned_pinyin` tokens for both training and online inference; main-post text is kept for browsing/export, but it is no longer part of the model input.

## Known limits

- X DOM parsing is best-effort and may require selector updates.
- The TF.js model is optional during early development; heuristics continue to work if model files are absent.
- The default sample data is intentionally small and only intended for smoke tests.
