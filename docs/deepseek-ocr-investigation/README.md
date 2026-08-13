# DeepSeek OCR 2 8-bit Test

Recipe for Deepseek [vllm_example.py](vllm_example.py) from VLLM:
[https://recipes.vllm.ai/deepseek-ai/DeepSeek-OCR-2](https://recipes.vllm.ai/deepseek-ai/DeepSeek-OCR-2)

Command-line example [from-card.sh](from-card.sh) from:
[https://huggingface.co/mlx-community/DeepSeek-OCR-2-8bit](https://huggingface.co/mlx-community/DeepSeek-OCR-2-8bit)

## MLX-VLM Usage (uv)

Install dependencies from the uv manifest:

```bash
uv sync
```

Run command-line OCR directly (same as [from-card.sh](from-card.sh)):

```bash
uv run python -m mlx_vlm.generate \
  --model mlx-community/DeepSeek-OCR-2-8bit \
  --max-tokens 8192 \
  --temperature 0.0 \
  --prompt "<|grounding|>Convert the document to markdown." \
  --image page-0001.png
```

Run Python example script ([mlx_vlm_example.py](mlx_vlm_example.py)):

```bash
uv run python mlx_vlm_example.py
```

Optional overrides:

```bash
uv run python mlx_vlm_example.py \
  --image page-0001.png \
  --model mlx-community/DeepSeek-OCR-2-8bit \
  --prompt "<|grounding|>Convert the document to markdown." \
  --max-tokens 8192 \
  --temperature 0.0
```

## Incident Notes

RCA and after-action report: [RCA_after_action_report.md](RCA_after_action_report.md)
