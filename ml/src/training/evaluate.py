from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from src.models.textcnn import PinyinTextCNN
from src.preprocessing.dataset_builder import read_dataset
from src.training.train import JsonlDataset, evaluate_model


def main() -> None:
    parser = argparse.ArgumentParser(description='Evaluate a trained TextCNN checkpoint.')
    parser.add_argument('--dataset', required=True, help='Path to dataset.jsonl.')
    parser.add_argument('--checkpoint', required=True, help='Path to the checkpoint file.')
    parser.add_argument('--output-errors', default='outputs/misclassified.json', help='Path for misclassified samples.')
    args = parser.parse_args()

    rows = read_dataset(Path(args.dataset))
    checkpoint = torch.load(Path(args.checkpoint), map_location='cpu')
    config = checkpoint['config']
    model = PinyinTextCNN(
        vocab_size=checkpoint['vocab_size'],
        embedding_dim=config['embedding_dim'],
        num_filters=config['num_filters'],
    )
    model.load_state_dict(checkpoint['state_dict'])

    dataset = JsonlDataset(rows)
    loader = DataLoader(dataset, batch_size=config['batch_size'])
    metrics = evaluate_model(model, loader, torch.device('cpu'), config['decision_threshold'])

    misclassified = collect_misclassified(model, rows, config['decision_threshold'])
    output_path = Path(args.output_errors)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(misclassified, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps(metrics, ensure_ascii=False, indent=2))


def collect_misclassified(model: PinyinTextCNN, rows: list[dict], threshold: float) -> list[dict]:
    model.eval()
    mistakes: list[dict] = []
    with torch.no_grad():
        for row in rows:
            input_tensor = torch.tensor([row['input_ids']], dtype=torch.long)
            prediction = float(model(input_tensor).item())
            predicted_label = 1 if prediction >= threshold else 0
            if predicted_label != int(row['label']):
                mistakes.append(
                    {
                        'reply_id': row['reply_id'],
                        'label': row['label'],
                        'predicted_label': predicted_label,
                        'prediction': prediction,
                        'reply_text': row['reply_text'],
                        'source': row['source'],
                    }
                )
    return mistakes


if __name__ == '__main__':
    main()
