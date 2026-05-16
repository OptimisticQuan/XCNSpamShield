from pathlib import Path

import pytest
import torch

from src.export.export_onnx import main as export_onnx_main
from src.models.textcnn import PinyinTextCNN, pool_convolution_output


def test_textcnn_forward_probability_shape() -> None:
    model = PinyinTextCNN(vocab_size=64)
    output = model(torch.randint(0, 64, (2, 30), dtype=torch.long))
    assert output.shape == (2,)


def test_textcnn_uses_kernel_sizes_2_through_5() -> None:
    model = PinyinTextCNN(vocab_size=64)
    assert model.kernel_sizes == (2, 3, 4, 5)
    assert [conv.kernel_size[0] for conv in model.convs] == [2, 3, 4, 5]
    assert model.fc.in_features == 32 * 4
    assert model.embedding.padding_idx == 0


def test_pool_convolution_output_ignores_fully_padded_windows() -> None:
    activated = torch.tensor([[[1.0, 2.0, 100.0]]])
    token_mask = torch.tensor([[1.0, 1.0, 1.0, 0.0]])

    pooled = pool_convolution_output(activated, token_mask, kernel_size=2)

    assert torch.allclose(pooled, torch.tensor([[3.5]]))


def test_export_module_exists() -> None:
    assert callable(export_onnx_main)
