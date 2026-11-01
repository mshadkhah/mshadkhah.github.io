"""Kokoro text-to-speech server for a home machine.

POST /speak with JSON {"text": "...", "voice": "af_heart", "speed": 1.0}
returns a WAV file. Requests must include the header X-Token equal to the
KOKORO_TOKEN environment variable, so strangers cannot use the server.

Run on the home machine:
    export KOKORO_TOKEN="a-long-random-string"
    uvicorn server:app --host 0.0.0.0 --port 8880
"""
import io
import os

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from kokoro import KPipeline

TOKEN = os.environ.get("KOKORO_TOKEN", "")
MAX_CHARS = 6000
ALLOWED_VOICES = {"af_heart", "af_bella", "am_michael", "bf_emma"}  # adjust to voices you installed

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mshadkhah.github.io", "http://127.0.0.1:8001"],
    allow_methods=["POST"],
    allow_headers=["Content-Type", "X-Token"],
)

# American English pipeline. Loaded once at startup so each request only generates audio.
pipeline = KPipeline(lang_code="a", device="cpu")  # CPU is fast enough for Kokoro and avoids GPU memory errors


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: str = "af_heart"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


@app.post("/speak")
def speak(req: SpeakRequest, x_token: str = Header(default="")):
    if not TOKEN or x_token != TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
    if req.voice not in ALLOWED_VOICES:
        raise HTTPException(status_code=400, detail="Voice not available")

    chunks = []
    for _, _, audio in pipeline(req.text, voice=req.voice, speed=req.speed):
        chunks.append(audio)
    if not chunks:
        raise HTTPException(status_code=422, detail="No speech generated")

    buffer = io.BytesIO()
    sf.write(buffer, np.concatenate(chunks), 24000, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")
