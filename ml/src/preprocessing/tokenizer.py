from __future__ import annotations

from pathlib import Path
from typing import Iterable

from src.preprocessing.pinyin_normalizer import build_model_input_from_cleaned_pinyin

SPECIAL_TOKENS = ['[PAD]', '[UNK]', '[CLS]', '[SEP]']
BASE_VOCAB = SPECIAL_TOKENS + [
    ':',
    '✈️',
    '😡',
    '😎',
    '😱',
    '😮',
    '🤯',
    '🍑',
    '🔥',
    '🥰',
    '🍀',
    '🙏',
]


class Vocabulary:
    def __init__(self, tokens: Iterable[str]):
        ordered_tokens = list(dict.fromkeys(tokens))
        self.tokens = ordered_tokens
        self.token_to_id = {token: index for index, token in enumerate(ordered_tokens)}

    def encode(self, tokens: list[str], sequence_length: int) -> list[int]:
        unknown_id = self.token_to_id['[UNK]']
        padded_tokens = tokens[:sequence_length]
        while len(padded_tokens) < sequence_length:
            padded_tokens.append('[PAD]')
        return [self.token_to_id.get(token, unknown_id) for token in padded_tokens]

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('\n'.join(self.tokens), encoding='utf-8')

    @classmethod
    def load(cls, path: Path) -> 'Vocabulary':
        return cls(path.read_text(encoding='utf-8').splitlines())


def build_vocabulary(cleaned_pinyins: Iterable[str]) -> Vocabulary:
    tokens = list(BASE_VOCAB)
    for cleaned_pinyin in cleaned_pinyins:
        tokens.extend(build_model_input_from_cleaned_pinyin(cleaned_pinyin))
    return Vocabulary(tokens)
