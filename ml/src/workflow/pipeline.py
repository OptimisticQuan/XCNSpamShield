from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from src.preprocessing.dataset_builder import DEFAULT_AUGMENTATION_PATH, DEFAULT_RAW_DATA_PATH, DEFAULT_VOCAB_PATH, build_dataset_rows, write_dataset


ML_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATASET_PATH = ML_ROOT / 'data' / 'processed' / 'dataset.jsonl'
DEFAULT_ORIGINAL_ONLY_DATASET_PATH = ML_ROOT / 'data' / 'processed' / 'dataset-original-only.jsonl'
DEFAULT_HOLDOUT_CHECKPOINT_DIR = ML_ROOT / 'outputs' / 'checkpoints-seq30-kernel25-holdout'
DEFAULT_FINAL_CHECKPOINT_DIR = ML_ROOT / 'outputs' / 'checkpoints-seq30-kernel25-final'
DEFAULT_HOLDOUT_ERRORS_PATH = ML_ROOT / 'outputs' / 'misclassified-seq30-kernel25-holdout-original.json'
DEFAULT_FINAL_ERRORS_PATH = ML_ROOT / 'outputs' / 'misclassified-seq30-kernel25-final-original.json'
DEFAULT_ONNX_PATH = ML_ROOT / 'outputs' / 'onnx' / 'spam_model_kernel25.onnx'
DEFAULT_TFJS_OUTPUT_DIR = ML_ROOT / 'outputs' / 'tfjs_model_kernel25'
DEFAULT_SAVED_MODEL_DIR = ML_ROOT / 'outputs' / 'saved_model_kernel25'
DEFAULT_EXTENSION_MODEL_DIR = PROJECT_ROOT / 'extension' / 'public' / 'tfjs_model'
DEFAULT_EPOCHS = 12


def train_eval_export_main() -> None:
    args = parse_pipeline_args('Train, evaluate, convert, and deploy the current 2..5 TextCNN model.')
    run_train_eval(args)
    run_export_deploy(args)


def train_eval_main() -> None:
    args = parse_pipeline_args('Prepare data, train, and evaluate the current 2..5 TextCNN model.')
    run_train_eval(args)


def export_deploy_main() -> None:
    args = parse_pipeline_args('Export, convert, compare, and deploy the current 2..5 TextCNN checkpoint.', include_training_flags=False)
    run_export_deploy(args)


def parse_pipeline_args(description: str, include_training_flags: bool = True) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--input', action='append', help='Raw export JSON file or directory. Defaults to ml/data/raw/.')
    parser.add_argument('--augmentations', default=str(DEFAULT_AUGMENTATION_PATH), help='Optional hard-example augmentation JSON.')
    parser.add_argument('--vocab', default=str(DEFAULT_VOCAB_PATH), help='Where to write vocab.txt.')
    parser.add_argument('--dataset', default=str(DEFAULT_DATASET_PATH), help='Where to write dataset.jsonl.')
    parser.add_argument('--original-only-dataset', default=str(DEFAULT_ORIGINAL_ONLY_DATASET_PATH), help='Where to write the original-only evaluation dataset.')
    parser.add_argument('--holdout-checkpoint-dir', default=str(DEFAULT_HOLDOUT_CHECKPOINT_DIR), help='Holdout checkpoint directory.')
    parser.add_argument('--final-checkpoint-dir', default=str(DEFAULT_FINAL_CHECKPOINT_DIR), help='Final all-data checkpoint directory.')
    parser.add_argument('--holdout-errors', default=str(DEFAULT_HOLDOUT_ERRORS_PATH), help='Holdout misclassified output path.')
    parser.add_argument('--final-errors', default=str(DEFAULT_FINAL_ERRORS_PATH), help='Final misclassified output path.')
    parser.add_argument('--onnx-output', default=str(DEFAULT_ONNX_PATH), help='ONNX output path.')
    parser.add_argument('--tfjs-output-dir', default=str(DEFAULT_TFJS_OUTPUT_DIR), help='TF.js output directory.')
    parser.add_argument('--saved-model-dir', default=str(DEFAULT_SAVED_MODEL_DIR), help='Temporary SavedModel directory for TF.js conversion.')
    parser.add_argument('--extension-model-dir', default=str(DEFAULT_EXTENSION_MODEL_DIR), help='Extension TF.js model target directory.')
    parser.add_argument('--skip-copy-model', action='store_true', help='Do not copy TF.js artifacts into the extension directory.')

    if include_training_flags:
      parser.add_argument('--epochs', type=int, default=DEFAULT_EPOCHS, help='Epochs for both holdout and final training runs.')

    return parser.parse_args()


def run_train_eval(args: argparse.Namespace) -> None:
    dataset_path = Path(args.dataset)
    original_only_dataset_path = Path(args.original_only_dataset)
    prepare_pipeline_datasets(
        input_paths=[Path(value) for value in args.input] if args.input else [DEFAULT_RAW_DATA_PATH],
        augmentation_path=Path(args.augmentations) if args.augmentations else None,
        vocab_path=Path(args.vocab),
        dataset_path=dataset_path,
        original_only_dataset_path=original_only_dataset_path,
    )

    run_python_module(
        'src.training.train',
        [
            '--dataset',
            str(dataset_path),
            '--checkpoint-dir',
            str(Path(args.holdout_checkpoint_dir)),
            '--epochs',
            str(args.epochs),
        ],
    )
    run_python_module(
        'src.training.evaluate',
        [
            '--dataset',
            str(original_only_dataset_path),
            '--checkpoint',
            str(Path(args.holdout_checkpoint_dir) / 'best.pt'),
            '--output-errors',
            str(Path(args.holdout_errors)),
        ],
    )

    run_python_module(
        'src.training.train',
        [
            '--dataset',
            str(dataset_path),
            '--checkpoint-dir',
            str(Path(args.final_checkpoint_dir)),
            '--epochs',
            str(args.epochs),
            '--train-on-all',
        ],
    )
    run_python_module(
        'src.training.evaluate',
        [
            '--dataset',
            str(original_only_dataset_path),
            '--checkpoint',
            str(Path(args.final_checkpoint_dir) / 'best.pt'),
            '--output-errors',
            str(Path(args.final_errors)),
        ],
    )


def run_export_deploy(args: argparse.Namespace) -> None:
    final_checkpoint = Path(args.final_checkpoint_dir) / 'best.pt'
    original_only_dataset_path = Path(args.original_only_dataset)
    onnx_output_path = Path(args.onnx_output)
    tfjs_output_dir = Path(args.tfjs_output_dir)

    run_python_module(
        'src.export.export_onnx',
        [
            '--checkpoint',
            str(final_checkpoint),
            '--output',
            str(onnx_output_path),
        ],
    )
    run_python_module(
        'src.export.convert_tfjs',
        [
            '--onnx',
            str(onnx_output_path),
            '--output-dir',
            str(tfjs_output_dir),
            '--saved-model-dir',
            str(Path(args.saved_model_dir)),
            '--vocab',
            str(Path(args.vocab)),
        ],
    )
    run_python_module(
        'src.export.compare_backends',
        [
            '--dataset',
            str(original_only_dataset_path),
            '--checkpoint',
            str(final_checkpoint),
            '--onnx',
            str(onnx_output_path),
        ],
    )

    if not args.skip_copy_model:
        run_node_script(
            PROJECT_ROOT / 'scripts' / 'copy-model.mjs',
            [
                '--source',
                str(tfjs_output_dir),
                '--target',
                str(Path(args.extension_model_dir)),
            ],
        )


def prepare_pipeline_datasets(
    input_paths: list[Path],
    augmentation_path: Path | None,
    vocab_path: Path,
    dataset_path: Path,
    original_only_dataset_path: Path,
) -> None:
    _, rows = build_dataset_rows(
        export_paths=input_paths,
        vocab_path=vocab_path,
        augmentation_path=augmentation_path,
    )
    write_dataset(dataset_path, rows)
    write_dataset(original_only_dataset_path, [row for row in rows if 'augmented_from' not in row])
    print(f'Prepared {len(rows)} rows at {dataset_path}')
    print(f'Prepared {sum(1 for row in rows if "augmented_from" not in row)} original-only rows at {original_only_dataset_path}')


def run_python_module(module_name: str, args: list[str]) -> None:
    command = [sys.executable, '-m', module_name, *args]
    print('$', ' '.join(command))
    subprocess.run(command, check=True, cwd=ML_ROOT)


def run_node_script(script_path: Path, args: list[str]) -> None:
    command = ['node', str(script_path), *args]
    print('$', ' '.join(command))
    subprocess.run(command, check=True, cwd=PROJECT_ROOT)