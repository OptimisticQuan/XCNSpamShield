"""Minimal stub for tensorflowjs_converter.

The converter imports tensorflow_decision_forests unconditionally when reading a
SavedModel, even if the model does not depend on TFDF. Our exported TextCNN does
not use TFDF, so this stub avoids an unrelated protobuf version conflict during
conversion.
"""
