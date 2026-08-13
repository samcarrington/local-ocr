from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, cast

from mlx_vlm import generate, load
from mlx_vlm.models.deepseekocr_2 import DeepseekOCR2Processor
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import StoppingCriteria, get_model_path, load_model, load_tokenizer


def _extract_text(result: Any) -> str:
    """Normalize mlx-vlm generate output across versions."""
    if isinstance(result, str):
        return result
    text_value = getattr(result, "text", None)
    if isinstance(text_value, str):
        return text_value
    return str(result)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run DeepSeek OCR (quantized MLX-VLM) on a local image."
    )
    parser.add_argument(
        "--model",
        default="mlx-community/DeepSeek-OCR-2-8bit",
        help="Model repo id (quantized MLX-VLM model).",
    )
    parser.add_argument(
        "--image",
        default="page-0001.png",
        help="Path to input image or PDF.",
    )
    parser.add_argument(
        "--prompt",
        default="<|grounding|>Convert the document to markdown.",
        help="OCR prompt.",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=8192,
        help="Maximum number of generated tokens.",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.0,
        help="Sampling temperature.",
    )
    return parser.parse_args()


def _is_deepseek_ocr2(model_id: str) -> bool:
    model_lower = model_id.lower()
    return "deepseek-ocr-2" in model_lower or "deepseek_ocr_2" in model_lower


def _load_deepseek_ocr2(model_id: str) -> tuple[Any, Any]:
    """Load DeepSeek-OCR-2 via the same low-level components used by the CLI path."""
    model_path = get_model_path(model_id)
    model = load_model(model_path)

    # Keep trust_remote_code disabled so this path does not require torch/torchvision.
    processor = DeepseekOCR2Processor.from_pretrained(
        str(model_path), trust_remote_code=False
    )

    # Match mlx_vlm.utils.load_processor setup expected by mlx_vlm.generate().
    detokenizer_class = cast(Any, load_tokenizer(model_path, return_tokenizer=False))
    setattr(processor, "detokenizer", detokenizer_class(processor.tokenizer))

    eos_token_ids_raw = getattr(processor.tokenizer, "eos_token_ids", None) or getattr(
        processor.tokenizer, "eos_token_id", None
    )
    if isinstance(eos_token_ids_raw, int):
        eos_token_ids = [eos_token_ids_raw]
    elif isinstance(eos_token_ids_raw, (list, tuple, set)):
        eos_token_ids = [int(token_id) for token_id in eos_token_ids_raw]
    else:
        eos_token_ids = [int(getattr(model.config, "eos_token_id", 1))]

    setattr(
        processor.tokenizer,
        "stopping_criteria",
        StoppingCriteria(eos_token_ids, processor.tokenizer),
    )

    return model, processor


def main() -> None:
    args = parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        raise FileNotFoundError(f"Input not found: {image_path}")

    if _is_deepseek_ocr2(args.model):
        model, processor = _load_deepseek_ocr2(args.model)
    else:
        model, processor = load(args.model)
    formatted_prompt = cast(
        str,
        apply_chat_template(
            processor,
            model.config,
            args.prompt,
            num_images=1,
        ),
    )

    result = generate(
        model=model,
        processor=cast(Any, processor),
        image=str(image_path),
        prompt=formatted_prompt,
        max_tokens=args.max_tokens,
        temperature=args.temperature,
    )

    print(_extract_text(result))


if __name__ == "__main__":
    main()
