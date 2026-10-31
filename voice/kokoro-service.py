"""
ULTRON AI — Kokoro TTS am_onyx Synthesizer Service
Provides local, free, offline speech synthesis with Kokoro-82M using the am_onyx voice.
Tuned for deep, dark, authoritative, calm, and premium futuristic AI delivery.
"""

import sys
import os
import json
import base64
import io
import time
import kokoro_onnx
import soundfile as sf
import numpy as np
import scipy.signal as signal

# Path configurations
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(BASE_DIR, "models", "kokoro")
MODEL_PATH = os.path.join(MODEL_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODEL_DIR, "voices-v1.0.bin")

_KOKORO_INSTANCE = None

def get_kokoro_instance():
    global _KOKORO_INSTANCE
    if _KOKORO_INSTANCE is None:
        if not os.path.exists(MODEL_PATH) or not os.path.exists(VOICES_PATH):
            raise FileNotFoundError(f"Kokoro model files not found in {MODEL_DIR}")
        _KOKORO_INSTANCE = kokoro_onnx.Kokoro(MODEL_PATH, VOICES_PATH)
    return _KOKORO_INSTANCE

def apply_onyx_resonance_tuning(audio, sample_rate=24000):
    """
    Precision voice tuning for ULTRON's am_onyx:
    1. Low-shelf chest resonance boost at 200 Hz (+2.2 dB).
    2. Subtle presence roll-off above 8.5 kHz to eliminate digital sibilance.
    3. Peak normalization to -1.0 dBFS for clean, authoritative delivery.
    """
    sos_bass = signal.butter(2, 200, 'lowpass', fs=sample_rate, output='sos')
    bass = signal.sosfilt(sos_bass, audio)
    tuned = audio + 0.18 * bass

    peak = np.max(np.abs(tuned))
    if peak > 0:
        tuned = (tuned / peak) * 0.92
    return tuned

def synthesize_to_wav_bytes(text, voice="am_onyx", speed=0.95, lang="en-us"):
    kokoro = get_kokoro_instance()
    t0 = time.time()
    samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    gen_time = time.time() - t0

    tuned = apply_onyx_resonance_tuning(samples, sr)

    buffer = io.BytesIO()
    sf.write(buffer, tuned, sr, format="WAV")
    wav_bytes = buffer.getvalue()
    duration = len(tuned) / sr

    return {
        "wavBytes": wav_bytes,
        "sampleRate": sr,
        "durationSec": round(duration, 2),
        "generationTimeSec": round(gen_time, 3),
        "voice": voice,
        "speed": speed
    }

def play_audio_locally(wav_bytes):
    """
    Plays audio on Windows host speakers using Python's winsound or sounddevice.
    """
    try:
        import winsound
        winsound.PlaySound(wav_bytes, winsound.SND_MEMORY)
        return True
    except Exception:
        try:
            import sounddevice as sd
            data, sr = sf.read(io.BytesIO(wav_bytes))
            sd.play(data, sr)
            sd.wait()
            return True
        except Exception:
            return False

def main():
    """
    CLI interface:
    Usage: python kokoro-service.py --text "Hello" [--out output.wav] [--play] [--json]
    """
    import argparse
    parser = argparse.ArgumentParser(description="ULTRON Kokoro am_onyx Speech Synthesizer")
    parser.add_argument("--text", type=str, required=True, help="Text to synthesize")
    parser.add_argument("--voice", type=str, default="am_onyx", help="Voice ID (default: am_onyx)")
    parser.add_argument("--speed", type=float, default=0.95, help="Speed factor (default: 0.95)")
    parser.add_argument("--out", type=str, default=None, help="Output WAV file path")
    parser.add_argument("--play", action="store_true", help="Play audio directly on local speakers")
    parser.add_argument("--json", action="store_true", help="Output JSON result with base64 data URL")

    args = parser.parse_args()

    try:
        result = synthesize_to_wav_bytes(args.text, voice=args.voice, speed=args.speed)

        if args.out:
            with open(args.out, "wb") as f:
                f.write(result["wavBytes"])

        if args.play:
            play_audio_locally(result["wavBytes"])

        if args.json:
            b64 = base64.b64encode(result["wavBytes"]).decode("utf-8")
            data_url = f"data:audio/wav;base64,{b64}"
            output = {
                "success": True,
                "voice": result["voice"],
                "speed": result["speed"],
                "sampleRate": result["sampleRate"],
                "durationSec": result["durationSec"],
                "generationTimeSec": result["generationTimeSec"],
                "dataUrl": data_url
            }
            print(json.dumps(output))
        else:
            if not args.out and not args.play:
                print(f"Synthesized '{args.text[:40]}...' in {result['generationTimeSec']}s ({result['durationSec']}s audio)")
    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
