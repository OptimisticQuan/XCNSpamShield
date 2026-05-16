from pathlib import Path

from src.preprocessing.dataset_builder import HARD_EXAMPLE_AUGMENT_WEIGHT, build_dataset_rows, iter_reply_rows


def test_iter_reply_rows_prefers_exported_cleaned_pinyin() -> None:
    rows = iter_reply_rows(
        [
            (
                Path('sample-a.json'),
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
                },
            )
        ]
    )

    assert rows[0]['cleaned_pinyin'] == 'xiao xuan : sao 😎'
    assert rows[0]['source'] == 'manual'


def test_iter_reply_rows_requires_cleaned_pinyin() -> None:
    try:
        iter_reply_rows(
            [
                (
                    Path('legacy.json'),
                    {
                        'data': [
                            {
                                'thread_id': 'thread-1',
                                'replies': [
                                    {
                                        'reply_id': 'reply-1',
                                        'label': 0,
                                        'source': 'auto',
                                    }
                                ],
                            }
                        ]
                    },
                )
            ]
        )
    except ValueError as error:
        assert 'Missing cleaned_pinyin' in str(error)
    else:
        raise AssertionError('Expected iter_reply_rows to reject replies without cleaned_pinyin')


def test_build_dataset_rows_uses_reply_only_model_tokens(tmp_path: Path) -> None:
    export_path = tmp_path / 'sample.json'
    export_path.write_text(
        '{"data": [{"thread_id": "thread-1", "main_post": {"author": "main", "text": "主贴内容", "timestamp": 1}, "replies": [{"reply_id": "reply-1", "author": "reply_user", "author_name": "晓萱", "original_text": "$ao", "cleaned_pinyin": "xiao xuan : sao 😎", "label": 1, "source": "manual"}]}]}',
        encoding='utf-8',
    )

    _, rows = build_dataset_rows([export_path], vocab_path=tmp_path / 'vocab.txt')

    assert rows[0]['tokens'] == ['[CLS]', 'xiao', 'xuan', ':', 'sao', '😎', '[SEP]']


def test_build_dataset_rows_merges_all_raw_json_replies(tmp_path: Path) -> None:
    raw_dir = tmp_path / 'raw'
    raw_dir.mkdir()
    (raw_dir / 'a.json').write_text(
        '{"data": [{"thread_id": "thread-a", "replies": [{"reply_id": "reply-a", "cleaned_pinyin": "ni hao", "label": 0, "source": "auto"}]}]}',
        encoding='utf-8',
    )
    (raw_dir / 'b.json').write_text(
        '{"data": [{"thread_id": "thread-b", "replies": [{"reply_id": "reply-b", "cleaned_pinyin": "zai jian", "label": 1, "source": "manual"}]}]}',
        encoding='utf-8',
    )

    _, rows = build_dataset_rows([raw_dir], vocab_path=tmp_path / 'vocab.txt')

    assert [row['reply_id'] for row in rows] == ['reply-a', 'reply-b']


def test_build_dataset_rows_applies_hard_example_augmentations(tmp_path: Path) -> None:
    export_path = tmp_path / 'sample.json'
    export_path.write_text(
        '{"data": [{"thread_id": "thread-1", "replies": [{"reply_id": "reply-1", "cleaned_pinyin": ": tui te di yi sao n", "label": 1, "source": "auto"}]}]}',
        encoding='utf-8',
    )
    augmentation_path = tmp_path / 'augmentations.json'
    augmentation_path.write_text(
        '[{"reply_id": "reply-1", "variants": [": tui te di yi sao", "tui te di yi sao"]}]',
        encoding='utf-8',
    )

    _, rows = build_dataset_rows([export_path], vocab_path=tmp_path / 'vocab.txt', augmentation_path=augmentation_path)

    assert [row['reply_id'] for row in rows] == ['reply-1', 'reply-1#aug1', 'reply-1#aug2']
    assert rows[1]['cleaned_pinyin'] == ': tui te di yi sao'
    assert rows[1]['weight'] == HARD_EXAMPLE_AUGMENT_WEIGHT