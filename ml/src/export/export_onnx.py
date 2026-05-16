from __future__ import annotations

import argparse
from pathlib import Path

import torch

from src.models.textcnn import PinyinTextCNN


def main() -> None:
    parser = argparse.ArgumentParser(description='Export a trained checkpoint to ONNX.')
    parser.add_argument('--checkpoint', required=True, help='Path to the checkpoint file.')
    parser.add_argument('--output', default='outputs/onnx/spam_model.onnx', help='Output ONNX path.')
    args = parser.parse_args()

    checkpoint = torch.load(Path(args.checkpoint), map_location='cpu')
    config = checkpoint['config']
    model = PinyinTextCNN(
        vocab_size=checkpoint['vocab_size'],
        embedding_dim=config['embedding_dim'],
        num_filters=config['num_filters'],
        dropout_rate=config.get('dropout_rate', 0.2),
    )
    model.load_state_dict(checkpoint['state_dict'])
    model.eval()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    dummy_input = torch.randint(0, checkpoint['vocab_size'], (1, config['sequence_length']), dtype=torch.long)
    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        input_names=['input'],
        output_names=['output'],
        opset_version=13,
        dynamo=False,
    )
    print(f'Exported ONNX model to {output_path}')


if __name__ == '__main__':
    main()
