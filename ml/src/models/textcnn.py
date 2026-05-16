from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F


class PinyinTextCNN(nn.Module):
    def __init__(self, vocab_size: int, embedding_dim: int = 64, num_filters: int = 32):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
        self.conv2 = nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=2)
        self.conv3 = nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=3)
        self.conv4 = nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=4)
        self.fc = nn.Linear(num_filters * 3, 1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        embedded = self.embedding(inputs)
        embedded = embedded.permute(0, 2, 1)

        conv2 = F.max_pool1d(F.relu(self.conv2(embedded)), embedded.shape[2] - 1).squeeze(2)
        conv3 = F.max_pool1d(F.relu(self.conv3(embedded)), embedded.shape[2] - 2).squeeze(2)
        conv4 = F.max_pool1d(F.relu(self.conv4(embedded)), embedded.shape[2] - 3).squeeze(2)

        merged = torch.cat((conv2, conv3, conv4), dim=1)
        return torch.sigmoid(self.fc(merged)).squeeze(1)
