from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from torch import nn
from torch.utils.data import DataLoader, Dataset

from src.models.textcnn import PinyinTextCNN
from src.preprocessing.dataset_builder import read_dataset
from src.training.config import TrainingConfig


class JsonlDataset(Dataset):
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict:
        row = self.rows[index]
        return {
            'input_ids': torch.tensor(row['input_ids'], dtype=torch.long),
            'label': torch.tensor(float(row['label']), dtype=torch.float32),
            'weight': torch.tensor(float(row['weight']), dtype=torch.float32),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description='Train the pinyin-level TextCNN model.')
    parser.add_argument('--dataset', required=True, help='Path to dataset.jsonl.')
    parser.add_argument('--checkpoint-dir', default='outputs/checkpoints', help='Directory for saved checkpoints.')
    parser.add_argument('--epochs', type=int, default=8, help='Number of training epochs.')
    parser.add_argument('--batch-size', type=int, default=16, help='Batch size.')
    parser.add_argument('--learning-rate', type=float, default=1e-3, help='Learning rate.')
    args = parser.parse_args()

    config = TrainingConfig(epochs=args.epochs, batch_size=args.batch_size, learning_rate=args.learning_rate)
    rows = read_dataset(Path(args.dataset))
    if len(rows) < 2:
        raise SystemExit('Dataset must contain at least two rows.')

    set_seed(config.seed)
    train_rows, validation_rows = split_rows(rows)
    train_loader = DataLoader(JsonlDataset(train_rows), batch_size=config.batch_size, shuffle=True)
    validation_loader = DataLoader(JsonlDataset(validation_rows), batch_size=config.batch_size)

    vocab_size = max(max(row['input_ids']) for row in rows) + 1
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = PinyinTextCNN(vocab_size=vocab_size, embedding_dim=config.embedding_dim, num_filters=config.num_filters).to(device)
    criterion = nn.BCELoss(reduction='none')
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)

    best_f1 = -1.0
    checkpoint_dir = Path(args.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    for epoch in range(config.epochs):
        train_loss = train_epoch(model, train_loader, criterion, optimizer, device)
        metrics = evaluate_model(model, validation_loader, device, config.decision_threshold)
        print(
            json.dumps(
                {
                    'epoch': epoch + 1,
                    'train_loss': train_loss,
                    **metrics,
                },
                ensure_ascii=False,
            )
        )

        if metrics['f1'] > best_f1:
            best_f1 = metrics['f1']
            torch.save(
                {
                    'state_dict': model.state_dict(),
                    'config': config.to_dict(),
                    'metrics': metrics,
                    'vocab_size': vocab_size,
                },
                checkpoint_dir / 'best.pt',
            )


def train_epoch(
    model: PinyinTextCNN,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> float:
    model.train()
    losses: list[float] = []

    for batch in loader:
        optimizer.zero_grad(set_to_none=True)
        input_ids = batch['input_ids'].to(device)
        labels = batch['label'].to(device)
        weights = batch['weight'].to(device)

        predictions = model(input_ids)
        loss = criterion(predictions, labels)
        weighted_loss = (loss * weights).mean()
        weighted_loss.backward()
        optimizer.step()
        losses.append(float(weighted_loss.detach().cpu()))

    return float(np.mean(losses)) if losses else 0.0


def evaluate_model(model: PinyinTextCNN, loader: DataLoader, device: torch.device, threshold: float) -> dict[str, float]:
    model.eval()
    labels: list[float] = []
    predictions: list[float] = []

    with torch.no_grad():
        for batch in loader:
            input_ids = batch['input_ids'].to(device)
            labels.extend(batch['label'].tolist())
            predictions.extend(model(input_ids).cpu().tolist())

    binary_predictions = [1 if value >= threshold else 0 for value in predictions]
    integer_labels = [int(value) for value in labels]

    return {
        'accuracy': accuracy_score(integer_labels, binary_predictions),
        'precision': precision_score(integer_labels, binary_predictions, zero_division=0),
        'recall': recall_score(integer_labels, binary_predictions, zero_division=0),
        'f1': f1_score(integer_labels, binary_predictions, zero_division=0),
    }


def split_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    labels = [row['label'] for row in rows]
    if len(set(labels)) < 2 or len(rows) < 5:
        split_index = max(1, int(len(rows) * 0.8))
        return rows[:split_index], rows[split_index:] or rows[:1]

    train_rows, validation_rows = train_test_split(rows, test_size=0.2, random_state=42, stratify=labels)
    return list(train_rows), list(validation_rows)


def set_seed(seed: int) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


if __name__ == '__main__':
    main()
