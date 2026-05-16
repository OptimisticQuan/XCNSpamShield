from src.preprocessing.tokenizer import build_vocabulary, tokenize_cleaned_pinyin


def test_tokenize_cleaned_pinyin() -> None:
    assert tokenize_cleaned_pinyin('xiao xuan : sao 😎') == ['[CLS]', 'xiao', 'xuan', ':', 'sao', '😎', '[SEP]']


def test_tokenize_empty_cleaned_pinyin() -> None:
    assert tokenize_cleaned_pinyin('   ') == ['[CLS]', '[UNK]', '[SEP]']


def test_build_vocabulary_contains_special_tokens() -> None:
    vocabulary = build_vocabulary(['zhu ye neng da'])
    assert vocabulary.tokens[:4] == ['[PAD]', '[UNK]', '[CLS]', '[SEP]']
