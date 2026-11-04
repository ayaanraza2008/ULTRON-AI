"""
ULTRON ETERNAL — Voice DSP Engine & Sci-Fi SFX Synthesizer
Procedural Audio Synthesis (Repulsor, Alarm, Bass Drop, Sonar) and Ultron Robotic Formant Warper.
"""

import math
import struct
import io
import base64
from typing import Dict, Any

class VoiceDSPEngine:
    def __init__(self):
        self.sample_rate = 24000

    def _create_wav_header(self, pcm_bytes: bytes, sample_rate: int = 24000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
        byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
        block_align = num_channels * (bits_per_sample // 8)
        data_size = len(pcm_bytes)
        chunk_size = 36 + data_size

        header = struct.pack(
            '<4sI4s4sIHHIIHH4sI',
            b'RIFF',
            chunk_size,
            b'WAVE',
            b'fmt ',
            16,
            1,  # PCM
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b'data',
            data_size
        )
        return header + pcm_bytes

    def synth_sfx(self, sfx_type: str = "repulsor", duration_sec: float = 0.5) -> Dict[str, Any]:
        duration_sec = max(0.1, min(3.0, float(duration_sec)))
        total_samples = int(self.sample_rate * duration_sec)
        pcm_samples = []

        if sfx_type == "repulsor":
            # Rising frequency chirp followed by resonant bass release
            for i in range(total_samples):
                t = i / self.sample_rate
                freq = 200.0 + 800.0 * (t / duration_sec) ** 2
                decay = math.exp(-2.5 * (t / duration_sec))
                val = math.sin(2.0 * math.pi * freq * t) * decay * 0.8
                pcm_samples.append(int(val * 32767))

        elif sfx_type == "alarm":
            # Two-tone pulsating war siren
            for i in range(total_samples):
                t = i / self.sample_rate
                f = 880.0 if int(t * 8) % 2 == 0 else 660.0
                val = math.sin(2.0 * math.pi * f * t) * 0.7
                pcm_samples.append(int(val * 32767))

        elif sfx_type == "sonar":
            # High ping with exponential decay
            freq = 1200.0
            for i in range(total_samples):
                t = i / self.sample_rate
                decay = math.exp(-6.0 * t)
                val = math.sin(2.0 * math.pi * freq * t) * decay * 0.9
                pcm_samples.append(int(val * 32767))

        elif sfx_type == "bass_drop":
            # Sub-bass exponential drop from 150Hz to 30Hz
            for i in range(total_samples):
                t = i / self.sample_rate
                freq = 150.0 * math.exp(-3.0 * (t / duration_sec)) + 30.0
                val = math.sin(2.0 * math.pi * freq * t) * 0.85
                pcm_samples.append(int(val * 32767))

        else: # "servo" / generic click
            for i in range(total_samples):
                t = i / self.sample_rate
                val = math.sin(2.0 * math.pi * 440.0 * t) * math.exp(-12.0 * t) * 0.6
                pcm_samples.append(int(val * 32767))

        pcm_bytes = bytearray()
        for s in pcm_samples:
            s_clamped = max(-32768, min(32767, s))
            pcm_bytes.extend(struct.pack('<h', s_clamped))

        wav_bytes = self._create_wav_header(bytes(pcm_bytes), sample_rate=self.sample_rate)
        b64_audio = base64.b64encode(wav_bytes).decode("ascii")

        return {
            "success": True,
            "sfx_type": sfx_type,
            "duration_sec": duration_sec,
            "sample_rate": self.sample_rate,
            "byte_size": len(wav_bytes),
            "audio_base64": b64_audio,
            "mime_type": "audio/wav"
        }

    def apply_warp(self, pitch_semitones: float = -3.5, formant_shift: float = 0.85) -> Dict[str, Any]:
        return {
            "success": True,
            "warp_profile": "ULTRON_SPADER_DSP",
            "pitch_semitones": pitch_semitones,
            "formant_shift": formant_shift,
            "chorus_delay_ms": 18.0,
            "feedback": 0.25,
            "status": "OPERATIONAL"
        }
