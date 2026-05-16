from src.preprocessing.pinyin_normalizer import build_model_input_from_cleaned_pinyin, normalize_reply_to_pinyin_words, normalize_text_to_pinyin_words
from src.preprocessing.tokenizer import build_vocabulary


def test_normalize_text_to_pinyin_words() -> None:
    assert normalize_text_to_pinyin_words('这只猫好乖。') == 'zhe zhi mao hao guai'


def test_normalize_reply_to_pinyin_words() -> None:
    assert normalize_reply_to_pinyin_words('晓萱~❀同城上门', '$ao the 👆❤️\n‌‍👏\n🎊 💪😎💅') == 'xiao xuan tong cheng shang men : sao 👆 ❤️ 👏 🎊 💪 😎 💅'


def test_build_model_input_from_cleaned_pinyin() -> None:
    assert build_model_input_from_cleaned_pinyin('xiao xuan : sao 😎') == ['[CLS]', 'xiao', 'xuan', ':', 'sao', '😎', '[SEP]']


def test_build_vocabulary_contains_special_tokens() -> None:
    vocabulary = build_vocabulary(['zhu ye neng da'])
    assert vocabulary.tokens[:4] == ['[PAD]', '[UNK]', '[CLS]', '[SEP]']
