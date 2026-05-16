from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description='Convert ONNX model to TensorFlow.js using onnx2tf and tensorflowjs_converter.')
    parser.add_argument('--onnx', required=True, help='Path to the ONNX file.')
    parser.add_argument('--output-dir', required=True, help='Target directory for TF.js model files.')
    parser.add_argument('--saved-model-dir', default='outputs/saved_model', help='Temporary TensorFlow SavedModel directory.')
    parser.add_argument('--vocab', default='data/vocab.txt', help='Optional vocab.txt to copy next to the TF.js model.')
    args = parser.parse_args()

    ensure_command('onnx2tf')
    ensure_command('tensorflowjs_converter')

    saved_model_dir = Path(args.saved_model_dir)
    output_dir = Path(args.output_dir)
    saved_model_dir.parent.mkdir(parents=True, exist_ok=True)
    output_dir.parent.mkdir(parents=True, exist_ok=True)

    subprocess.run(['onnx2tf', '-i', args.onnx, '-o', str(saved_model_dir)], check=True)
    converter_env = build_tensorflowjs_converter_env()
    subprocess.run(
        [
            'tensorflowjs_converter',
            '--input_format=tf_saved_model',
            '--output_format=tfjs_graph_model',
            str(saved_model_dir),
            str(output_dir),
        ],
        check=True,
        env=converter_env,
    )

    vocab_path = Path(args.vocab)
    if vocab_path.exists():
        shutil.copy2(vocab_path, output_dir / 'vocab.txt')

    print(f'Wrote TF.js model to {output_dir}')


def ensure_command(command: str) -> None:
    if shutil.which(command):
        return
    raise SystemExit(f'{command} was not found on PATH. Install the export dependencies first.')


def build_tensorflowjs_converter_env() -> dict[str, str]:
    env = os.environ.copy()
    stub_root = Path(__file__).resolve().parent / 'tensorflowjs_stubs'
    existing_pythonpath = env.get('PYTHONPATH', '')
    env['PYTHONPATH'] = f'{stub_root}{os.pathsep}{existing_pythonpath}' if existing_pythonpath else str(stub_root)
    return env


if __name__ == '__main__':
    main()
