"""Launch mlx-vlm with a DeepSeek-OCR-2 cross-thread tensor handoff fix.

mlx-vlm preprocesses HTTP requests on a worker thread and evaluates them on
its continuous-batching generation thread. MLX arrays are bound to their
creating thread's GPU stream, so DeepSeek-OCR-2 fails when it evaluates image
tensors created by the worker. The wrapper transfers only DeepSeek request
tensors through NumPy before the generation-thread handoff.
"""

from __future__ import annotations

from typing import Any

import mlx.core as mx
import numpy as np
from mlx_vlm.server.generation import ResponseGenerator
from mlx_vlm.tokenizer_utils import StreamingDetokenizer
from mlx_vlm.utils import get_model_path
from tokenizers import Tokenizer

DEEPSEEK_OCR_2_MODEL_MARKER = "deepseek-ocr-2"


class DeepseekOcr2StreamingDetokenizer(StreamingDetokenizer):
    """Decode DeepSeek OCR-2 tokens with its bundled fast-tokenizer metadata."""

    def __init__(self, tokenizer_path: str) -> None:
        self._tokenizer_path = tokenizer_path
        self._tokenizer = Tokenizer.from_file(tokenizer_path)
        self.reset()

    def __copy__(self) -> 'DeepseekOcr2StreamingDetokenizer':
        return type(self)(self._tokenizer_path)

    def reset(self) -> None:
        self.offset = 0
        self.tokens: list[int] = []

    def add_token(self, token: int, skip_special_token_ids: list[int] = []) -> None:
        if token not in skip_special_token_ids:
            self.tokens.append(token)

    def finalize(self) -> None:
        return

    @property
    def text(self) -> str:
        return self._tokenizer.decode(self.tokens)


def is_deepseek_ocr_2(generator: ResponseGenerator) -> bool:
    return DEEPSEEK_OCR_2_MODEL_MARKER in generator.model_path.lower()


def move_to_host(value: Any) -> Any:
    if isinstance(value, mx.array):
        return np.array(value.tolist())
    if isinstance(value, dict):
        return {key: move_to_host(item) for key, item in value.items()}
    if isinstance(value, list):
        return [move_to_host(item) for item in value]
    if isinstance(value, tuple):
        return tuple(move_to_host(item) for item in value)
    return value


def move_to_gpu(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return mx.array(value)
    if isinstance(value, dict):
        return {key: move_to_gpu(item) for key, item in value.items()}
    if isinstance(value, list):
        return [move_to_gpu(item) for item in value]
    if isinstance(value, tuple):
        return tuple(move_to_gpu(item) for item in value)
    return value


def install_deepseek_ocr_2_handoff() -> None:
    if getattr(ResponseGenerator, "_local_ocr_handoff_installed", False):
        return

    original_cpu_preprocess = ResponseGenerator._cpu_preprocess
    original_gpu_embed = ResponseGenerator._gpu_embed
    original_initialize_model = ResponseGenerator._initialize_model

    def initialize_model(self: ResponseGenerator) -> None:
        original_initialize_model(self)
        if is_deepseek_ocr_2(self):
            tokenizer_path = get_model_path(self.model_path) / 'tokenizer.json'
            self.processor.detokenizer = DeepseekOcr2StreamingDetokenizer(
                str(tokenizer_path),
            )

    def cpu_preprocess(
        self: ResponseGenerator, *args: Any, **kwargs: Any
    ) -> dict[str, Any]:
        raw_inputs = original_cpu_preprocess(self, *args, **kwargs)
        return move_to_host(raw_inputs) if is_deepseek_ocr_2(self) else raw_inputs

    def gpu_embed(
        self: ResponseGenerator, raw_inputs: dict[str, Any], images: Any = None
    ) -> tuple[mx.array, dict[str, Any]]:
        if is_deepseek_ocr_2(self):
            raw_inputs = move_to_gpu(raw_inputs)
        return original_gpu_embed(self, raw_inputs, images)

    ResponseGenerator._cpu_preprocess = cpu_preprocess
    ResponseGenerator._gpu_embed = gpu_embed
    ResponseGenerator._initialize_model = initialize_model
    ResponseGenerator._local_ocr_handoff_installed = True


install_deepseek_ocr_2_handoff()

from mlx_vlm.server import main


if __name__ == "__main__":
    main()
