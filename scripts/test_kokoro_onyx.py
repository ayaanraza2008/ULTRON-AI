"""
ULTRON AI — Kokoro am_onyx TTS Benchmarking & Audio Generation Script
Generates and tunes all 5 test scripts specified in the Voice Directive.
"""

import os
import time
import psutil
import kokoro_onnx
import soundfile as sf
import numpy as np
import scipy.signal as signal

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "kokoro")
MODEL_PATH = os.path.join(MODEL_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODEL_DIR, "voices-v1.0.bin")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "voice")

os.makedirs(OUTPUT_DIR, exist_ok=True)

def apply_resonance_enhancement(audio, sample_rate=24000):
    """
    Subtle warm resonance filter:
    1. Low-shelf boost below 220Hz (+2dB) for deep chest resonance.
    2. Dynamic peak normalization to -0.8 dBFS without clipping.
    """
    sos_bass = signal.butter(2, 220, 'lowpass', fs=sample_rate, output='sos')
    bass = signal.sosfilt(sos_bass, audio)
    tuned = audio + 0.18 * bass

    peak = np.max(np.abs(tuned))
    if peak > 0:
        tuned = (tuned / peak) * 0.94
    return tuned

TEST_SCRIPTS = [
    {
        "id": "test_1_introduction",
        "name": "TEST 1 — INTRODUCTION",
        "text": "Systems online. I am ULTRON. All core processes are operational. Awaiting your command."
    },
    {
        "id": "test_2_authoritative",
        "name": "TEST 2 — AUTHORITATIVE RESPONSE",
        "text": "Understood. I have analyzed the situation. The optimal solution is ready. Executing the approved operation."
    },
    {
        "id": "test_3_dark_futuristic",
        "name": "TEST 3 — DARK FUTURISTIC PERSONALITY",
        "text": "I am ULTRON. I observe, analyze, and learn. Every system is connected. Every action has a purpose."
    },
    {
        "id": "test_4_hinglish",
        "name": "TEST 4 — HINGLISH",
        "text": "Systems online. Main ULTRON hoon. Tumhara system ready hai. Batao, aaj kya execute karna hai?"
    },
    {
        "id": "test_5_long_response",
        "name": "TEST 5 — LONG RESPONSE",
        "text": "All diagnostic parameters remain within optimal bounds. Memory consumption is stabilized under eighty-five percent. The multi-agent orchestrator is coordinating background workers, while the cognitive memory vault maintains verified provenance. Whenever you are ready, specify the target directive and execution will commence immediately."
    }
]

def main():
    process = psutil.Process()
    ram_before = process.memory_info().rss / (1024 * 1024)
    print(f"Initial RAM Usage: {ram_before:.2f} MB")

    t0 = time.time()
    kokoro = kokoro_onnx.Kokoro(MODEL_PATH, VOICES_PATH)
    load_time = time.time() - t0
    ram_loaded = process.memory_info().rss / (1024 * 1024)
    print(f"Kokoro loaded in {load_time:.2f}s | RAM: {ram_loaded:.2f} MB (Delta: +{ram_loaded - ram_before:.2f} MB)")

    results = []

    for item in TEST_SCRIPTS:
        t_start = time.time()
        samples, sr = kokoro.create(item["text"], voice="am_onyx", speed=0.95)
        raw_dur = len(samples) / sr
        gen_time = time.time() - t_start

        tuned = apply_resonance_enhancement(samples, sr)
        out_path = os.path.join(OUTPUT_DIR, f"{item['id']}.wav")
        sf.write(out_path, tuned, sr)
        file_size = os.path.getsize(out_path)

        rtf = gen_time / raw_dur if raw_dur > 0 else 0
        ram_now = process.memory_info().rss / (1024 * 1024)

        result_entry = {
            "test": item["name"],
            "text": item["text"],
            "audioPath": out_path,
            "durationSec": round(raw_dur, 2),
            "generationTimeSec": round(gen_time, 2),
            "realTimeFactor": round(rtf, 2),
            "sampleRate": sr,
            "fileSizeBytes": file_size,
            "ramMb": round(ram_now, 2)
        }
        results.append(result_entry)
        print(f"[{item['name']}] Duration: {raw_dur:.2f}s | GenTime: {gen_time:.2f}s (RTF: {rtf:.2f}x) | File: {file_size} bytes")

    print("\n--- ALL 5 TEST AUDIOS SUCCESSFULLY GENERATED WITH KOKORO am_onyx ---")
    return results

if __name__ == "__main__":
    main()
