import torch
from torch.utils.data import DataLoader, Dataset

from src.training.train import select_decision_threshold, split_rows


class _ProbabilityDataset(Dataset):
    def __init__(self, labels: list[float]):
        self.labels = labels

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, index: int) -> dict:
        return {
            'input_ids': torch.tensor([index], dtype=torch.long),
            'label': torch.tensor(self.labels[index], dtype=torch.float32),
            'weight': torch.tensor(1.0, dtype=torch.float32),
        }


class _ReplayModel(torch.nn.Module):
    def __init__(self, predictions: list[float]):
        super().__init__()
        self.predictions = predictions

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        indices = inputs[:, 0].tolist()
        return torch.tensor([self.predictions[index] for index in indices], dtype=torch.float32)


def test_select_decision_threshold_prefers_zero_false_positives_then_fewer_false_negatives() -> None:
    loader = DataLoader(_ProbabilityDataset([1.0, 1.0, 0.0, 0.0]), batch_size=4)
    model = _ReplayModel([0.34, 0.04, 0.31, 0.02])

    threshold = select_decision_threshold(model, loader, torch.device('cpu'))

    assert threshold == 0.34


def test_split_rows_keeps_augmented_variants_in_same_partition() -> None:
    rows = [
        {'reply_id': 'reply-a', 'label': 1},
        {'reply_id': 'reply-a#aug1', 'augmented_from': 'reply-a', 'label': 1},
        {'reply_id': 'reply-b', 'label': 1},
        {'reply_id': 'reply-c', 'label': 0},
        {'reply_id': 'reply-d', 'label': 0},
        {'reply_id': 'reply-e', 'label': 0},
    ]

    train_rows, validation_rows = split_rows(rows)
    train_ids = {row['reply_id'] for row in train_rows}
    validation_ids = {row['reply_id'] for row in validation_rows}

    assert {'reply-a', 'reply-a#aug1'} <= train_ids or {'reply-a', 'reply-a#aug1'} <= validation_ids
    assert not ({'reply-a', 'reply-a#aug1'} & train_ids and {'reply-a', 'reply-a#aug1'} & validation_ids)