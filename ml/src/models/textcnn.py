from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F


PAD_TOKEN_ID = 0


class PinyinTextCNN(nn.Module):
    def __init__(self, vocab_size: int, embedding_dim: int = 64, num_filters: int = 32, dropout_rate: float = 0.2):
        super().__init__()
        # 给 [PAD] 固定一个全零 embedding，避免填充位参与参数更新。
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=PAD_TOKEN_ID)
        self.kernel_sizes = tuple(range(2, 6))
        self.convs = nn.ModuleList(
            nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=kernel_size)
            for kernel_size in self.kernel_sizes
        )
        # 在全连接层前做一点 dropout，降低小数据集过拟合风险。
        self.dropout = nn.Dropout(dropout_rate)
        # 每个卷积核把 max 值和 mean 值相加后只保留一组特征，因此输入维度等于卷积核个数 * num_filters。
        self.fc = nn.Linear(num_filters * len(self.kernel_sizes), 1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        # [batch, seq] -> [batch, seq, embedding_dim]
        embedded = self.embedding(inputs)
        # Conv1d 期望通道维在中间，所以转成 [batch, embedding_dim, seq]。
        embedded = embedded.permute(0, 2, 1)
        token_mask = inputs.ne(PAD_TOKEN_ID).to(dtype=embedded.dtype)

        pooled_outputs = [
            pool_convolution_output(F.relu(conv(embedded)), token_mask, conv.kernel_size[0])
            for conv in self.convs
        ]

        merged = self.dropout(torch.cat(pooled_outputs, dim=1))
        return torch.sigmoid(self.fc(merged)).squeeze(1)


def pool_convolution_output(activated: torch.Tensor, token_mask: torch.Tensor, kernel_size: int) -> torch.Tensor:
    # max pooling 更擅长抓住“某个强烈的 spam 触发片段是否出现过”。
    valid_window_mask = build_valid_window_mask(token_mask, kernel_size)
    valid_window_count = valid_window_mask.sum(dim=2)
    has_valid_window = valid_window_count > 0

    masked_max = torch.where(valid_window_mask, activated, torch.full_like(activated, -1e9))
    max_pooled = torch.where(has_valid_window, torch.amax(masked_max, dim=2), torch.zeros_like(activated[:, :, 0]))

    # mean pooling 则保留“整条回复里 spam 信号整体有多密集”。
    masked_sum = (activated * valid_window_mask.to(dtype=activated.dtype)).sum(dim=2)
    mean_pooled = torch.where(
        has_valid_window,
        masked_sum / valid_window_count.to(dtype=activated.dtype).clamp_min(1.0),
        torch.zeros_like(masked_sum),
    )
    # 这里按你的意思直接把二者相加，形成每个卷积核的一组综合特征。
    return max_pooled + mean_pooled


def build_valid_window_mask(token_mask: torch.Tensor, kernel_size: int) -> torch.Tensor:
    # 只有卷积窗口完全落在真实 token 范围内，才允许进入后续池化。
    pooled_mask = F.avg_pool1d(token_mask.unsqueeze(1), kernel_size=kernel_size, stride=1)
    return pooled_mask.eq(1.0)
