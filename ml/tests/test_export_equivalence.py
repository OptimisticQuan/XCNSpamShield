from pathlib import Path

import pytest
import torch

from src.export.export_onnx import main as export_onnx_main
from src.models.textcnn import PinyinTextCNN


def test_textcnn_forward_probability_shape() -> None:
    model = PinyinTextCNN(vocab_size=64)
    output = model(torch.randint(0, 64, (2, 100), dtype=torch.long))
    assert output.shape == (2,)


def test_export_module_exists() -> None:
    assert callable(export_onnx_main)
