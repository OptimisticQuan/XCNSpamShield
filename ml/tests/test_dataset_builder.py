from pathlib import Path

from src.preprocessing.dataset_builder import build_dataset_rows, iter_reply_rows


def test_iter_reply_rows_prefers_exported_cleaned_pinyin() -> None:
    rows = iter_reply_rows(
        [
            {
                'data': [
                    {
                        'thread_id': 'thread-1',
                        'main_post': {'author': 'main', 'text': '主贴内容', 'timestamp': 1},
                        'replies': [
                            {
                                'reply_id': 'reply-1',
                                'author': 'reply_user',
                                'author_name': '晓萱',
                                'original_text': '$ao',
                                'cleaned_pinyin': 'xiao xuan : sao 😎',
                                'label': 1,
                                'source': 'manual',
                            }
                        ],
                    }
                ]
            }
        ]
    )

    assert rows[0]['cleaned_pinyin'] == 'xiao xuan : sao 😎'


def test_build_dataset_rows_uses_reply_only_model_tokens(tmp_path: Path) -> None:
    export_path = tmp_path / 'sample.json'
    export_path.write_text(
        '{"data": [{"thread_id": "thread-1", "main_post": {"author": "main", "text": "主贴内容", "timestamp": 1}, "replies": [{"reply_id": "reply-1", "author": "reply_user", "author_name": "晓萱", "original_text": "$ao", "cleaned_pinyin": "xiao xuan : sao 😎", "label": 1, "source": "manual"}]}]}',
        encoding='utf-8',
    )

    _, rows = build_dataset_rows([export_path], vocab_path=tmp_path / 'vocab.txt')

    assert rows[0]['tokens'] == ['[CLS]', 'xiao', 'xuan', ':', 'sao', '😎', '[SEP]']