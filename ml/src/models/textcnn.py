from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F


class PinyinTextCNN(nn.Module):
    def __init__(self, vocab_size: int, embedding_dim: int = 64, num_filters: int = 32):
        super().__init__()
        # 先把离散 token id 映射成稠密向量，后续卷积就在这个向量序列上做模式匹配。
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
        self.kernel_sizes = tuple(range(2, 8))
        self.convs = nn.ModuleList(
            nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=kernel_size)
            for kernel_size in self.kernel_sizes
        )
        # 每个卷积核把 max 值和 mean 值相加后只保留一组特征，因此输入维度不再翻倍。
        self.fc = nn.Linear(num_filters * len(self.kernel_sizes), 1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        # [batch, seq] -> [batch, seq, embedding_dim]
        embedded = self.embedding(inputs)
        # Conv1d 期望通道维在中间，所以转成 [batch, embedding_dim, seq]。
        embedded = embedded.permute(0, 2, 1)

        pooled_outputs = [
            pool_convolution_output(F.relu(conv(embedded)))
            for conv in self.convs
        ]

        merged = torch.cat(pooled_outputs, dim=1)
        return torch.sigmoid(self.fc(merged)).squeeze(1)


def pool_convolution_output(activated: torch.Tensor) -> torch.Tensor:
    # max pooling 更擅长抓住“某个强烈的 spam 触发片段是否出现过”。
    max_pooled = torch.amax(activated, dim=2)
    # mean pooling 则保留“整条回复里 spam 信号整体有多密集”。
    mean_pooled = torch.mean(activated, dim=2)
    # 这里按你的意思直接把二者相加，形成每个卷积核的一组综合特征。
    return max_pooled + mean_pooled
