from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(slots=True)
class TrainingConfig:
    # 这里集中放训练和推理都要共享的超参数，保存 checkpoint 时也会一并写入。
    sequence_length: int = 100
    embedding_dim: int = 64
    num_filters: int = 32
    batch_size: int = 16
    epochs: int = 8
    learning_rate: float = 1e-3
    positive_class_weight: float = 1.25
    negative_class_weight: float = 1.0
    seed: int = 42
    manual_weight: float = 1.5
    auto_weight: float = 1.0
    decision_threshold: float = 0.32

    def to_dict(self) -> dict:
        return asdict(self)
