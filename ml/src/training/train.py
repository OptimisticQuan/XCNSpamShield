from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path

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
        # rows 是 prepare-dataset 产出的 JSONL 行，这里只负责包装成 DataLoader 可消费的形式。
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
    # 训练脚本只关心三个输入：数据集路径、训练轮数、以及少量核心超参数。
    parser = argparse.ArgumentParser(description='Train the pinyin-level TextCNN model.')
    parser.add_argument('--dataset', required=True, help='Path to dataset.jsonl.')
    parser.add_argument('--checkpoint-dir', default='outputs/checkpoints', help='Directory for saved checkpoints.')
    parser.add_argument('--epochs', type=int, default=8, help='Number of training epochs.')
    parser.add_argument('--batch-size', type=int, default=16, help='Batch size.')
    parser.add_argument('--learning-rate', type=float, default=1e-3, help='Learning rate.')
    parser.add_argument('--positive-class-weight', type=float, default=1.25, help='Extra multiplier for spam samples.')
    parser.add_argument('--negative-class-weight', type=float, default=1.0, help='Extra multiplier for ham samples.')
    parser.add_argument('--train-on-all', action='store_true', help='Train on all rows after the architecture is decided. Metrics are no longer holdout metrics.')
    args = parser.parse_args()

    config = TrainingConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        positive_class_weight=args.positive_class_weight,
        negative_class_weight=args.negative_class_weight,
    )
    rows = read_dataset(Path(args.dataset))
    if len(rows) < 2:
        raise SystemExit('Dataset must contain at least two rows.')

    set_seed(config.seed)
    # 固定随机种子后再切分训练/验证集，保证多次实验更容易复现。
    if args.train_on_all:
        train_rows = rows
        validation_rows = rows
    else:
        train_rows, validation_rows = split_rows(rows)
    train_loader = DataLoader(JsonlDataset(train_rows), batch_size=config.batch_size, shuffle=True)
    validation_loader = DataLoader(JsonlDataset(validation_rows), batch_size=config.batch_size)

    # vocab 是从数据集中编码出来的，因此最大 token id + 1 就是 embedding 词表大小。
    vocab_size = max(max(row['input_ids']) for row in rows) + 1
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = PinyinTextCNN(vocab_size=vocab_size, embedding_dim=config.embedding_dim, num_filters=config.num_filters).to(device)
    criterion = nn.BCELoss(reduction='none')
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)

    best_f1 = -1.0
    checkpoint_dir = Path(args.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    for epoch in range(config.epochs):
        train_loss = train_epoch(model, train_loader, criterion, optimizer, device, config)
        # 每个 epoch 后都在验证集上重新挑阈值，避免把阈值写死在 0.5。
        tuned_threshold = select_decision_threshold(model, validation_loader, device)
        metrics = evaluate_model(model, validation_loader, device, tuned_threshold)
        metrics['decision_threshold'] = tuned_threshold
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
            config.decision_threshold = tuned_threshold
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
    config: TrainingConfig,
) -> float:
    model.train()
    losses: list[float] = []

    for batch in loader:
        optimizer.zero_grad(set_to_none=True)
        input_ids = batch['input_ids'].to(device)
        labels = batch['label'].to(device)
        weights = batch['weight'].to(device)
        # source 权重区分 manual/auto，class_weights 则单独强调正负类别的重要性。
        class_weights = torch.where(
            labels >= 0.5,
            torch.full_like(labels, fill_value=config.positive_class_weight),
            torch.full_like(labels, fill_value=config.negative_class_weight),
        )

        predictions = model(input_ids)
        loss = criterion(predictions, labels)
        weighted_loss = (loss * weights * class_weights).mean()
        weighted_loss.backward()
        optimizer.step()
        losses.append(float(weighted_loss.detach().cpu()))

    return float(np.mean(losses)) if losses else 0.0


def evaluate_model(model: PinyinTextCNN, loader: DataLoader, device: torch.device, threshold: float) -> dict[str, float]:
    # 评估阶段先拿到连续分数，再按阈值转换成 0/1 标签，最后计算分类指标。
    labels, predictions = collect_labels_and_predictions(model, loader, device)
    binary_predictions = [1 if value >= threshold else 0 for value in predictions]
    integer_labels = [int(value) for value in labels]

    return {
        'accuracy': accuracy_score(integer_labels, binary_predictions),
        'precision': precision_score(integer_labels, binary_predictions, zero_division=0),
        'recall': recall_score(integer_labels, binary_predictions, zero_division=0),
        'f1': f1_score(integer_labels, binary_predictions, zero_division=0),
    }


def select_decision_threshold(model: PinyinTextCNN, loader: DataLoader, device: torch.device) -> float:
    # 这里不是“找 F1 最大”这么简单，而是先最小化总错误数，再优先减少假阳性。
    labels, predictions = collect_labels_and_predictions(model, loader, device)
    integer_labels = [int(value) for value in labels]
    best_threshold = 0.5
    best_key: tuple[float, int, int, float] | None = None

    for step in range(1, 100):
        threshold = step / 100
        binary_predictions = [1 if value >= threshold else 0 for value in predictions]
        false_positives = sum(1 for label, predicted in zip(integer_labels, binary_predictions) if label == 0 and predicted == 1)
        false_negatives = sum(1 for label, predicted in zip(integer_labels, binary_predictions) if label == 1 and predicted == 0)
        f1 = f1_score(integer_labels, binary_predictions, zero_division=0)
        candidate_key = (false_positives + false_negatives, false_positives, false_negatives, -f1)

        if best_key is None or candidate_key < best_key:
            best_key = candidate_key
            best_threshold = threshold

    return best_threshold


def collect_labels_and_predictions(
    model: PinyinTextCNN,
    loader: DataLoader,
    device: torch.device,
) -> tuple[list[float], list[float]]:
    # 训练和评估共用这段推理逻辑，避免同一套前向代码维护两份。
    model.eval()
    labels: list[float] = []
    predictions: list[float] = []

    with torch.no_grad():
        for batch in loader:
            input_ids = batch['input_ids'].to(device)
            labels.extend(batch['label'].tolist())
            predictions.extend(model(input_ids).cpu().tolist())

    return labels, predictions


def split_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    # 数据够大时做分层抽样，让训练集和验证集的正负样本比例尽量一致。
    labels = [row['label'] for row in rows]
    if len(set(labels)) < 2 or len(rows) < 5:
        split_index = max(1, int(len(rows) * 0.8))
        return rows[:split_index], rows[split_index:] or rows[:1]

    grouped_rows: dict[str, list[dict]] = {}
    for row in rows:
        group_id = str(row.get('augmented_from') or row['reply_id'])
        grouped_rows.setdefault(group_id, []).append(row)

    if len(grouped_rows) < 5:
        train_rows, validation_rows = train_test_split(rows, test_size=0.2, random_state=42, stratify=labels)
        return list(train_rows), list(validation_rows)

    group_ids = list(grouped_rows)
    group_labels = [int(grouped_rows[group_id][0]['label']) for group_id in group_ids]
    class_counts = Counter(group_labels)
    validation_group_count = max(1, int(round(len(group_ids) * 0.2)))

    if len(set(group_labels)) < 2:
        train_rows, validation_rows = train_test_split(rows, test_size=0.2, random_state=42, stratify=labels)
        return list(train_rows), list(validation_rows)

    if min(class_counts.values()) < 2 or validation_group_count < len(class_counts):
        shuffled_group_ids = list(group_ids)
        rng = np.random.default_rng(42)
        rng.shuffle(shuffled_group_ids)
        validation_group_ids = shuffled_group_ids[:validation_group_count]
        train_group_ids = shuffled_group_ids[validation_group_count:]
    else:
        train_group_ids, validation_group_ids = train_test_split(
            group_ids,
            test_size=0.2,
            random_state=42,
            stratify=group_labels,
        )

    train_rows = [row for group_id in train_group_ids for row in grouped_rows[group_id]]
    validation_rows = [row for group_id in validation_group_ids for row in grouped_rows[group_id]]

    return list(train_rows), list(validation_rows)


def set_seed(seed: int) -> None:
    # 固定 numpy / torch 的随机性，便于对比不同模型结构的真实收益。
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


if __name__ == '__main__':
    main()
