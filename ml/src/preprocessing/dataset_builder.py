from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from src.preprocessing.tokenizer import Vocabulary, build_vocabulary, tokenize_cleaned_pinyin

DEFAULT_RAW_DATA_PATH = Path('data/raw')
DEFAULT_AUGMENTATION_PATH = Path('data/augmentations/hard_positive_replies.json')
DEFAULT_VOCAB_PATH = Path('data/vocab.txt')
DEFAULT_DATASET_PATH = Path('data/processed/dataset.jsonl')
SEQUENCE_LENGTH = 30
MANUAL_SAMPLE_WEIGHT = 1.5
AUTO_SAMPLE_WEIGHT = 1.0
HARD_EXAMPLE_AUGMENT_WEIGHT = 3.0


def load_export_payloads(paths: Iterable[Path]) -> list[tuple[Path, dict]]:
    payloads: list[tuple[Path, dict]] = []
    for path in expand_paths(paths):
        payloads.append((path, json.loads(path.read_text(encoding='utf-8'))))
    return payloads


def iter_reply_rows(payloads: Iterable[tuple[Path, dict]]) -> list[dict]:
    rows: list[dict] = []
    for payload_path, payload in payloads:
        for thread in payload.get('data', []):
            for reply in thread.get('replies', []):
                cleaned_pinyin = (reply.get('cleaned_pinyin') or '').strip()
                if not cleaned_pinyin:
                    raise ValueError(
                        f'Missing cleaned_pinyin for reply {reply.get("reply_id", "unknown")} in {payload_path}. '
                        'Re-export these samples with the extension before training.'
                    )
                rows.append(
                    {
                        'thread_id': thread.get('thread_id', ''),
                        'reply_id': reply.get('reply_id', ''),
                        'cleaned_pinyin': cleaned_pinyin,
                        'label': int(reply.get('label', 0)),
                        'source': reply.get('source', 'auto'),
                        'weight': MANUAL_SAMPLE_WEIGHT if reply.get('source') == 'manual' else AUTO_SAMPLE_WEIGHT,
                    }
                )
    return rows


def load_reply_augmentations(path: Path | None = DEFAULT_AUGMENTATION_PATH) -> dict[str, list[str]]:
    if path is None or not path.exists():
        return {}

    payload = json.loads(path.read_text(encoding='utf-8'))
    augmentations: dict[str, list[str]] = {}
    for item in payload:
        reply_id = str(item.get('reply_id', '')).strip()
        variants = [str(variant).strip() for variant in item.get('variants', []) if str(variant).strip()]
        if reply_id and variants:
            augmentations[reply_id] = variants
    return augmentations


def apply_reply_augmentations(rows: list[dict], augmentations: dict[str, list[str]]) -> list[dict]:
    if not augmentations:
        return rows

    augmented_rows = list(rows)
    for row in rows:
        variants = augmentations.get(row['reply_id'], [])
        for index, variant in enumerate(variants, start=1):
            augmented_rows.append(
                {
                    **row,
                    'reply_id': f"{row['reply_id']}#aug{index}",
                    'cleaned_pinyin': variant,
                    'weight': max(float(row['weight']), HARD_EXAMPLE_AUGMENT_WEIGHT),
                    'augmented_from': row['reply_id'],
                }
            )
    return augmented_rows


def build_dataset_rows(
    export_paths: Iterable[Path] | None = None,
    vocab_path: Path = DEFAULT_VOCAB_PATH,
    augmentation_path: Path | None = DEFAULT_AUGMENTATION_PATH,
) -> tuple[Vocabulary, list[dict]]:
    payloads = load_export_payloads(export_paths or [DEFAULT_RAW_DATA_PATH])
    rows = iter_reply_rows(payloads)
    rows = apply_reply_augmentations(rows, load_reply_augmentations(augmentation_path))
    vocabulary = build_vocabulary(row['cleaned_pinyin'] for row in rows)
    vocabulary.save(vocab_path)

    dataset_rows: list[dict] = []
    for row in rows:
        tokens = tokenize_cleaned_pinyin(row['cleaned_pinyin'])
        dataset_rows.append(
            {
                **row,
                'tokens': tokens,
                'input_ids': vocabulary.encode(tokens, sequence_length=SEQUENCE_LENGTH),
            }
        )

    return vocabulary, dataset_rows


def write_dataset(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')


def read_dataset(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]


def build_vocab_cli() -> None:
    parser = argparse.ArgumentParser(description='Build vocab.txt from exported JSON files in data/raw by default.')
    parser.add_argument('--input', action='append', help='Input export JSON file or directory. Defaults to data/raw/.')
    parser.add_argument('--output', default=str(DEFAULT_VOCAB_PATH), help='Path to vocab.txt.')
    parser.add_argument('--augmentations', default=str(DEFAULT_AUGMENTATION_PATH), help='Optional JSON file describing hard-example augmentations.')
    args = parser.parse_args()

    export_paths = [Path(value) for value in args.input] if args.input else [DEFAULT_RAW_DATA_PATH]
    payloads = load_export_payloads(export_paths)
    rows = iter_reply_rows(payloads)
    rows = apply_reply_augmentations(rows, load_reply_augmentations(Path(args.augmentations) if args.augmentations else None))
    vocabulary = build_vocabulary(row['cleaned_pinyin'] for row in rows)
    vocabulary.save(Path(args.output))
    print(f'Wrote {len(vocabulary.tokens)} tokens to {args.output}')


def prepare_dataset_cli() -> None:
    parser = argparse.ArgumentParser(description='Prepare a JSONL dataset from exported JSON files in data/raw by default.')
    parser.add_argument('--input', action='append', help='Input export JSON file or directory. Defaults to data/raw/.')
    parser.add_argument('--output', default=str(DEFAULT_DATASET_PATH), help='Path to dataset.jsonl.')
    parser.add_argument('--vocab', default=str(DEFAULT_VOCAB_PATH), help='Path to vocab.txt.')
    parser.add_argument('--augmentations', default=str(DEFAULT_AUGMENTATION_PATH), help='Optional JSON file describing hard-example augmentations.')
    args = parser.parse_args()

    export_paths = [Path(value) for value in args.input] if args.input else [DEFAULT_RAW_DATA_PATH]
    _, rows = build_dataset_rows(
        export_paths,
        vocab_path=Path(args.vocab),
        augmentation_path=Path(args.augmentations) if args.augmentations else None,
    )
    write_dataset(Path(args.output), rows)
    print(f'Prepared {len(rows)} rows at {args.output}')


def expand_paths(paths: Iterable[Path]) -> list[Path]:
    expanded: list[Path] = []
    for path in paths:
        if path.is_dir():
            expanded.extend(sorted(path.glob('*.json')))
        else:
            expanded.append(path)
    return expanded
