/**
 * ULTRON AI — Neural Speech & Voice Adapter Gateway
 * Evaluates and integrates voice technologies from:
 * - k2-fsa/OmniVoice (Multilingual neural TTS)
 * - resemble-ai/chatterbox (Neural prosody & consent-verified voice synthesis)
 *
 * Provides standardized adapter contracts for optional remote or local neural speech
 * engines while preserving ULTRON's local Kokoro-82M ONNX engine as primary offline baseline.
 * Enforces mandatory consent verification and synthetic media labeling on any voice cloning workflow.
 */

import { safeServiceBase } from "../network-safety.js";

export class NeuralSpeechGateway {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.customFetch = options.fetch || fetch;
  }

  /**
   * OmniVoice Speech Synthesis Adapter.
   */
  async synthesizeOmniVoice({ text = "", language = "en", voiceId = "default" } = {}) {
    const baseUrl = this.env.OMNIVOICE_API_BASE_URL;
    const apiKey = this.env.OMNIVOICE_API_KEY;
    const path = this.env.OMNIVOICE_SYNTHESIS_PATH || "/v1/audio/speech";

    if (!baseUrl || !apiKey) {
      return {
        success: false,
        fallbackToKokoro: true,
        error: "OMNIVOICE_UNCONFIGURED: Requires OMNIVOICE_API_BASE_URL and OMNIVOICE_API_KEY."
      };
    }

    const safeBase = safeServiceBase(baseUrl);
    if (!safeBase) {
      return {
        success: false,
        fallbackToKokoro: true,
        error: "SSRF_REJECTED: OMNIVOICE_API_BASE_URL is not an approved safe origin."
      };
    }

    try {
      const res = await this.customFetch(`${safeBase}${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: String(text).slice(0, 1000),
          model: "omnivoice",
          voice: voiceId,
          language
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        return { success: false, fallbackToKokoro: true, status: res.status, error: "OMNIVOICE_UPSTREAM_ERROR" };
      }

      const audioBuffer = await res.arrayBuffer();
      return {
        success: true,
        engine: "OMNIVOICE",
        audioBytes: audioBuffer.byteLength,
        language,
        voiceId
      };
    } catch (err) {
      return { success: false, fallbackToKokoro: true, error: err.message };
    }
  }

  /**
   * Resemble Chatterbox Adapter (enforces voice consent and synthetic-media watermark).
   */
  async synthesizeChatterbox({ text = "", voiceProfileId = "", consentRecord = {} } = {}) {
    const baseUrl = this.env.CHATTERBOX_BASE_URL;
    const apiKey = this.env.CHATTERBOX_API_KEY;

    if (!baseUrl || !apiKey) {
      return {
        success: false,
        fallbackToKokoro: true,
        error: "CHATTERBOX_UNCONFIGURED: Requires CHATTERBOX_BASE_URL and CHATTERBOX_API_KEY."
      };
    }

    // Security Gate: Enforce Explicit Consent for Voice Cloning / Neural Personas
    if (!consentRecord.authorized || !consentRecord.consentToken || !consentRecord.speakerConsentConfirmedAt) {
      return {
        success: false,
        fallbackToKokoro: true,
        error: "CONSENT_VERIFICATION_REQUIRED: Voice synthesis with custom voice profiles requires an explicit, verified consent token and speaker confirmation timestamp."
      };
    }

    const safeBase = safeServiceBase(baseUrl);
    if (!safeBase) {
      return {
        success: false,
        fallbackToKokoro: true,
        error: "SSRF_REJECTED: CHATTERBOX_BASE_URL is not an approved safe origin."
      };
    }

    try {
      const res = await this.customFetch(`${safeBase}/v1/speak`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Consent-Token": consentRecord.consentToken
        },
        body: JSON.stringify({
          data: String(text).slice(0, 1000),
          voice_uuid: voiceProfileId,
          include_watermark: true // Mandatory synthetic media watermark
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        return { success: false, fallbackToKokoro: true, status: res.status, error: "CHATTERBOX_UPSTREAM_ERROR" };
      }

      const audioBuffer = await res.arrayBuffer();
      return {
        success: true,
        engine: "CHATTERBOX",
        audioBytes: audioBuffer.byteLength,
        watermarkApplied: true,
        voiceProfileId
      };
    } catch (err) {
      return { success: false, fallbackToKokoro: true, error: err.message };
    }
  }
}

export const neuralSpeechGateway = new NeuralSpeechGateway();
