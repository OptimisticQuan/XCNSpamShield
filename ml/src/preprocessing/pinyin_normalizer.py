from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable
import unicodedata

from pypinyin import lazy_pinyin


PINYIN_SYLLABLES_PATH = Path(__file__).resolve().parents[3] / 'extension' / 'src' / 'ml' / 'pinyin-syllables.json'
CONFUSABLE_LATIN_MAP_PATH = Path(__file__).resolve().parents[3] / 'extension' / 'src' / 'ml' / 'confusable-latin-map.json'
PINYIN_SYLLABLES = set(json.loads(PINYIN_SYLLABLES_PATH.read_text(encoding='utf-8')))
CONFUSABLE_LATIN_MAP = json.loads(CONFUSABLE_LATIN_MAP_PATH.read_text(encoding='utf-8'))
ZERO_WIDTH_CHARACTERS = {
    '\u00ad',
    '\u034f',
    '\u061c',
    '\u115f',
    '\u1160',
    '\u17b4',
    '\u17b5',
    '\u180b',
    '\u180c',
    '\u180d',
    '\u180e',
    '\u200b',
    '\u200c',
    '\u200d',
    '\u200e',
    '\u200f',
    '\u202a',
    '\u202b',
    '\u202c',
    '\u202d',
    '\u202e',
    '\u2060',
    '\u2061',
    '\u2062',
    '\u2063',
    '\u2064',
    '\u2066',
    '\u2067',
    '\u2068',
    '\u2069',
    '\ufeff',
}
EXTENDED_PICTOGRAPHIC_RANGES = (
    (169, 169), (174, 174), (8252, 8252), (8265, 8265), (8482, 8482), (8505, 8505), (8596, 8601),
    (8617, 8618), (8986, 8987), (9000, 9000), (9167, 9167), (9193, 9203), (9208, 9210), (9410, 9410),
    (9642, 9643), (9654, 9654), (9664, 9664), (9723, 9726), (9728, 9732), (9742, 9742), (9745, 9745),
    (9748, 9749), (9752, 9752), (9757, 9757), (9760, 9760), (9762, 9763), (9766, 9766), (9770, 9770),
    (9774, 9775), (9784, 9786), (9792, 9792), (9794, 9794), (9800, 9811), (9823, 9824), (9827, 9827),
    (9829, 9830), (9832, 9832), (9851, 9851), (9854, 9855), (9874, 9879), (9881, 9881), (9883, 9884),
    (9888, 9889), (9895, 9895), (9898, 9899), (9904, 9905), (9917, 9918), (9924, 9925), (9928, 9928),
    (9934, 9935), (9937, 9937), (9939, 9940), (9961, 9962), (9968, 9973), (9975, 9978), (9981, 9981),
    (9986, 9986), (9989, 9989), (9992, 9997), (9999, 9999), (10002, 10002), (10004, 10004), (10006, 10006),
    (10013, 10013), (10017, 10017), (10024, 10024), (10035, 10036), (10052, 10052), (10055, 10055),
    (10060, 10060), (10062, 10062), (10067, 10069), (10071, 10071), (10083, 10084), (10133, 10135),
    (10145, 10145), (10160, 10160), (10175, 10175), (10548, 10549), (11013, 11015), (11035, 11036),
    (11088, 11088), (11093, 11093), (12336, 12336), (12349, 12349), (12951, 12951), (12953, 12953),
    (126980, 126980), (127020, 127023), (127124, 127135), (127151, 127152), (127168, 127168),
    (127183, 127184), (127222, 127231), (127344, 127345), (127358, 127359), (127374, 127374),
    (127377, 127386), (127406, 127461), (127489, 127503), (127514, 127514), (127535, 127535),
    (127538, 127546), (127548, 127551), (127561, 127583), (127590, 127777), (127780, 127891),
    (127894, 127895), (127897, 127899), (127902, 127984), (127987, 127989), (127991, 127994),
    (128000, 128253), (128255, 128317), (128329, 128334), (128336, 128359), (128367, 128368),
    (128371, 128378), (128391, 128391), (128394, 128397), (128400, 128400), (128405, 128406),
    (128420, 128421), (128424, 128424), (128433, 128434), (128444, 128444), (128450, 128452),
    (128465, 128467), (128476, 128478), (128481, 128481), (128483, 128483), (128488, 128488),
    (128495, 128495), (128499, 128499), (128506, 128591), (128640, 128709), (128715, 128722),
    (128725, 128741), (128745, 128745), (128747, 128752), (128755, 128767), (128986, 129023),
    (129036, 129039), (129096, 129103), (129114, 129119), (129160, 129167), (129198, 129199),
    (129212, 129215), (129218, 129231), (129241, 129279), (129292, 129338), (129340, 129349),
    (129351, 129535), (129624, 129631), (129646, 129791),
)


def normalize_text_to_pinyin_words(text: str) -> str:
    characters = list(unicodedata.normalize('NFKC', text.strip()))
    pieces: list[str] = []
    alpha_buffer: list[str] = []

    def flush_alpha_buffer() -> None:
        nonlocal alpha_buffer
        if not alpha_buffer:
            return

        segmented = segment_pinyin_sequence(''.join(alpha_buffer).lower())
        if segmented:
            pieces.extend(segmented)
        alpha_buffer = []

    index = 0
    while index < len(characters):
        emoji_token, next_index = consume_emoji_token(characters, index)
        if emoji_token is not None:
            flush_alpha_buffer()
            pieces.append(emoji_token)
            index = next_index
            continue

        character = CONFUSABLE_LATIN_MAP.get(characters[index], characters[index])

        if character.isspace():
            flush_alpha_buffer()
            index += 1
            continue

        if character == ':':
            flush_alpha_buffer()
            pieces.append(':')
            index += 1
            continue

        if character in ZERO_WIDTH_CHARACTERS:
            flush_alpha_buffer()
            index += 1
            continue

        if is_han(character):
            flush_alpha_buffer()
            converted = ''.join(lazy_pinyin(character, strict=False)).lower().replace('ü', 'v')
            if converted:
                pieces.append(converted)
            index += 1
            continue

        if is_ascii_alpha(character):
            alpha_buffer.append(character.lower())
            index += 1
            continue

        flush_alpha_buffer()
        index += 1

    flush_alpha_buffer()
    return ' '.join(pieces)


def normalize_reply_to_pinyin_words(author_name: str, text: str) -> str:
    prefix = author_name.strip()
    return normalize_text_to_pinyin_words(f'{prefix}:{text}' if prefix else text)


def split_cleaned_pinyin(cleaned_pinyin: str) -> list[str]:
    tokens = [piece for piece in cleaned_pinyin.split() if piece]
    return tokens or ['[UNK]']


def build_model_input_from_cleaned_pinyin(cleaned_pinyin: str) -> list[str]:
    return ['[CLS]', *split_cleaned_pinyin(cleaned_pinyin), '[SEP]']


def is_han(character: str) -> bool:
    return any('\u4e00' <= codepoint <= '\u9fff' for codepoint in character)


def normalize_many(texts: Iterable[str]) -> list[str]:
    return [normalize_text_to_pinyin_words(text) for text in texts]


def is_ascii_alpha(character: str) -> bool:
    return len(character) == 1 and 'a' <= character.lower() <= 'z'


def segment_pinyin_sequence(value: str) -> list[str] | None:
    if not value:
        return None

    memo: dict[int, list[str] | None] = {}

    def segment_from_index(start_index: int) -> list[str] | None:
        if start_index == len(value):
            return []

        if start_index in memo:
            return memo[start_index]

        for end_index in range(len(value), start_index, -1):
            candidate = value[start_index:end_index]
            if candidate not in PINYIN_SYLLABLES:
                continue

            remainder = segment_from_index(end_index)
            if remainder is not None:
                result = [candidate, *remainder]
                memo[start_index] = result
                return result

        memo[start_index] = None
        return None

    return segment_from_index(0)


def consume_emoji_token(characters: list[str], start_index: int) -> tuple[str | None, int]:
    first = characters[start_index]
    if not is_emoji_base(first):
        return None, start_index

    token = first
    index = start_index + 1

    while index < len(characters):
        current = characters[index]
        if is_variation_selector(current):
            token += current
            index += 1
            continue

        if current == '\u200d' and index + 1 < len(characters) and is_emoji_base(characters[index + 1]):
            token += current
            token += characters[index + 1]
            index += 2
            continue

        break

    return token, index


def is_emoji_base(character: str) -> bool:
    codepoint = ord(character)
    return any(start <= codepoint <= end for start, end in EXTENDED_PICTOGRAPHIC_RANGES)


def is_variation_selector(character: str) -> bool:
    return character in {'\ufe0e', '\ufe0f'}
