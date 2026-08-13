from vllm import LLM, SamplingParams
from vllm.model_executor.models.deepseek_ocr import NGramPerReqLogitsProcessor
from PIL import Image

llm = LLM(
    model="deepseek-ai/DeepSeek-OCR-2",
    enable_prefix_caching=False,
    mm_processor_cache_gb=0,
    logits_processors=[NGramPerReqLogitsProcessor],
)

image_1 = Image.open("page-0001.png").convert("RGB")

# prompt = "<image>\nFree OCR. "
prompt = "<image>\n<|grounding|>Convert the document to markdown. "

model_input = [
    {"prompt": prompt, "multi_modal_data": {"image": image_1}},
]

sampling_param = SamplingParams(
    temperature=0.0,
    max_tokens=8192,
    extra_args=dict(
        ngram_size=30,
        window_size=90,
        whitelist_token_ids={128821, 128822},  # <td>, </td>
    ),
    skip_special_tokens=False,
)

for output in llm.generate(model_input, sampling_param):
    print(output.outputs[0].text)
