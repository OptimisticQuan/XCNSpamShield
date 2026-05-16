from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime
import torch

from src.models.textcnn import PinyinTextCNN
from src.preprocessing.dataset_builder import read_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description='Compare PyTorch and ONNX outputs on dataset samples.')
    parser.add_argument('--dataset', required=True, help='Path to dataset.jsonl.')
    parser.add_argument('--checkpoint', required=True, help='Path to the checkpoint file.')
    parser.add_argument('--onnx', required=True, help='Path to the ONNX file.')
    parser.add_argument('--samples', type=int, default=16, help='Number of rows to compare.')
    parser.add_argument('--tfjs-predictions', help='Optional JSON file containing TF.js predictions keyed by reply_id.')
    args = parser.parse_args()

    rows = read_dataset(Path(args.dataset))[: args.samples]
    checkpoint = torch.load(Path(args.checkpoint), map_location='cpu')
    model = PinyinTextCNN(
        vocab_size=checkpoint['vocab_size'],
        embedding_dim=checkpoint['config']['embedding_dim'],
        num_filters=checkpoint['config']['num_filters'],
    )
    model.load_state_dict(checkpoint['state_dict'])
    model.eval()

    session = onnxruntime.InferenceSession(str(args.onnx), providers=['CPUExecutionProvider'])
    tfjs_predictions = load_tfjs_predictions(args.tfjs_predictions)

    comparisons: list[dict] = []
    for row in rows:
        input_ids = np.asarray([row['input_ids']], dtype=np.int64)
        with torch.no_grad():
            torch_prediction = float(model(torch.tensor(input_ids, dtype=torch.long)).item())
        onnx_prediction = float(session.run(None, {'input': input_ids})[0][0])
        comparison = {
            'reply_id': row['reply_id'],
            'torch': torch_prediction,
            'onnx': onnx_prediction,
            'abs_diff': abs(torch_prediction - onnx_prediction),
        }
        if tfjs_predictions is not None and row['reply_id'] in tfjs_predictions:
            tfjs_prediction = float(tfjs_predictions[row['reply_id']])
            comparison['tfjs'] = tfjs_prediction
            comparison['torch_tfjs_abs_diff'] = abs(torch_prediction - tfjs_prediction)
        comparisons.append(comparison)

    summary = {
        'max_abs_diff': max(entry['abs_diff'] for entry in comparisons) if comparisons else 0.0,
        'mean_abs_diff': float(np.mean([entry['abs_diff'] for entry in comparisons])) if comparisons else 0.0,
        'comparisons': comparisons,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def load_tfjs_predictions(path: str | None) -> dict[str, float] | None:
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding='utf-8'))


if __name__ == '__main__':
    main()
