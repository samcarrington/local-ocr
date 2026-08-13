# RCA and After-Action Report: DeepSeek-OCR-2 MLX-VLM Script Failure

## Executive Summary

`mlx_vlm_example.py` failed while `python -m mlx_vlm.generate ...` succeeded for the same model family (`mlx-community/DeepSeek-OCR-2-4bit` and `mlx-community/DeepSeek-OCR-2-8bit`).

Primary issue was initialization-path mismatch:

- Script used generic `mlx_vlm.load(...)`.
- CLI path handled DeepSeek-OCR-2 through a processor flow that succeeded in this environment.

The script was updated to use a DeepSeek-OCR-2 specific initialization path and now runs successfully.

## Impact

- Local Python script for OCR could not run.
- CLI command path remained usable.
- Time lost to differential diagnosis between CLI and Python API behavior.

## User-Facing Symptoms

- Error from script:
  - `ValueError: Unrecognized processing class ... Can't instantiate a processor ...`
- Working command:
  - `python -m mlx_vlm.generate --model mlx-community/DeepSeek-OCR-2-8bit ...`

## Detection

Detected during local execution of:

- `uv run python mlx_vlm_example.py`

Confirmed contrast by running both:

- `uv run python mlx_vlm_example.py ...` (failed before fix)
- `uv run python -m mlx_vlm.generate ...` (succeeded)

## Timeline (Condensed)

1. Created baseline `mlx_vlm_example.py` using `load(...)` + `generate(...)`.
2. `uv sync` initially failed due package build metadata; fixed with `[tool.uv] package = false`.
3. Script failed with `Unrecognized processing class` for DeepSeek-OCR-2 models.
4. CLI equivalent command succeeded in same environment.
5. Investigated `mlx_vlm` internals and reproduced mismatch in processor loading path.
6. Implemented DeepSeek-OCR-2 specific loader in script.
7. Wired detokenizer and stopping criteria expected by `generate(...)`.
8. Validated script execution success with `uv run python mlx_vlm_example.py --max-tokens 16`.

## Root Cause Analysis

### Direct Root Cause

The script used generic `mlx_vlm.load(...)`, which in this environment attempted an `AutoProcessor.from_pretrained(...)` path that failed for DeepSeek-OCR-2 processor metadata.

### Why CLI Still Worked

The CLI generation flow in installed `mlx_vlm` package reached a processor path that successfully initialized DeepSeek-OCR-2 for this setup, while the script's generic `load(...)` path did not.

### Contributing Factors

- Model-family-specific behavior hidden behind generic API.
- Processor initialization assumptions differ between code paths.
- Mixed/fragile metadata expectations for processor classes in this model family.

## Resolution Implemented

Updated `mlx_vlm_example.py`:

1. Added model-family detection for DeepSeek-OCR-2 IDs.
2. For DeepSeek-OCR-2 only, replaced generic `load(...)` path with:
   - `get_model_path(...)`
   - `load_model(...)`
   - `DeepseekOCR2Processor.from_pretrained(..., trust_remote_code=False)`
3. Added processor runtime wiring required by `generate(...)`:
   - detokenizer assignment
   - stopping criteria assignment
4. Kept generic `load(...)` fallback for non-DeepSeek model families.

## Verification Evidence

- Success command:
  - `uv run python mlx_vlm_example.py --max-tokens 16`
- Result:
  - script executed end-to-end and produced model output text.

## What Went Well

- Fast A/B comparison against known-good CLI command.
- Narrowed issue to initialization path rather than model weights.
- Fix scoped to one script, preserving default behavior for other models.

## What Went Wrong

- Initial assumption that generic API path would match CLI behavior for this model family.
- Extra debug cycles due processor-loading internals and dynamic behavior.

## Preventive / Follow-Up Actions

1. Keep model-family-specific loader branch for DeepSeek-OCR-2 in this project until upstream behavior converges.
2. Add a short note in `README.md` that DeepSeek-OCR-2 uses a special init path in `mlx_vlm_example.py`.
3. Add a smoke test command to validate script path after dependency changes:
   - `uv run python mlx_vlm_example.py --max-tokens 8`
4. On future upgrade of `mlx-vlm`, retest if generic `load(...)` works; if yes, simplify script and remove special branch.

## Residual Risk

- Upstream library updates may change internal contracts for processor/detokenizer wiring.
- DeepSeek-OCR-2 metadata or processor behavior may shift between snapshots/releases.

## Final Status

Resolved for current environment and current script.
