"""Time Kokoro on CPU and on CUDA with the same passage. Run on the home machine:
    source .venv/bin/activate && python bench.py
"""
import time

from kokoro import KPipeline

TEXT = (
    "Dr. Mishuana Goeman, of the Tonawanda Band of Seneca, is an associate professor of gender studies. "
    "In work such as this 2013 introduction to her book Mark My Words, Goeman examines spatiality through "
    "a feminist, Indigenous lens to interrogate how maps and Western spatial imaginings are inherently "
    "oppressive and a tool of imperialism. By studying narratives created by Indigenous women, Goeman "
    "challenges the colonized notion of place and urges those in struggle to resist using the tools and "
    "language of the oppressor. "
) * 6


def run(device):
    try:
        pipeline = KPipeline(lang_code="a", device=device)
    except Exception as error:
        print(f"{device}: could not load ({str(error)[:120]})")
        return
    # One warm-up pass so the timing excludes one-time setup.
    for _ in pipeline(TEXT[:200], voice="af_heart", speed=1.0):
        pass
    start = time.time()
    seconds = 0.0
    for _, _, audio in pipeline(TEXT, voice="af_heart", speed=1.0):
        seconds += len(audio) / 24000
    elapsed = time.time() - start
    print(f"{device}: generated {seconds:.1f}s of speech in {elapsed:.1f}s")


run("cpu")
run("cuda")
