from pathlib import Path

import pytest
import torch

from src.export.export_onnx import main as export_onnx_main
from src.models.textcnn import PinyinTextCNN


def test_textcnn_forward_probability_shape() -> None:
    model = PinyinTextCNN(vocab_size=64)
    output = model(torch.randint(0, 64, (2, 100), dtype=torch.long))
    assert output.shape == (2,)


def test_textcnn_uses_kernel_sizes_2_through_7() -> None:
    model = PinyinTextCNN(vocab_size=64)
    assert model.kernel_sizes == (2, 3, 4, 5, 6, 7)
    assert [conv.kernel_size[0] for conv in model.convs] == [2, 3, 4, 5, 6, 7]
    assert model.fc.in_features == 32 * 6


def test_export_module_exists() -> None:
    assert callable(export_onnx_main)
