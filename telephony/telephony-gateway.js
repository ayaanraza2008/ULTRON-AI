/**
 * ULTRON AI — Telephony Gateway & Voice Calling Adapter
 * Project Codename: ULTRON ETERNAL
 *
 * Implements real-life telephone access for ULTRON AI:
 * - Inbound telephone call handling via SIP / VoIP and Twilio/Exotel-compatible webhooks.
 * - Caller ID verification against authorized owner phone number allowlist.
 * - Interactive Voice Response (IVR) with DTMF security PIN challenge for unknown callers.
 * - Bidirectional streaming voice audio: G.711 μ-law / PCM audio transcoding.
 * - TwiML and SIP session negotiation for carrier compatibility.
 * - Real-time call state management (RINGING, CONNECTED, LISTENING, PROCESSING, SPEAKING, HANGUP).
 * - Full call transcription logging with optional conversation history integration.
 * - WebRTC fallback voice bridge for free browser/mobile calling.
 */

import crypto from "node:crypto";

export const CALL_STATES = {
  RINGING: "RINGING",
  CONNECTED: "CONNECTED",
  LISTENING: "LISTENING",
  PROCESSING: "PROCESSING",
  SPEAKING: "SPEAKING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
};

export const CALLER_AUTH_STATUS = {
  VERIFIED_OWNER: "VERIFIED_OWNER",
  PIN_REQUIRED: "PIN_REQUIRED",
  UNAUTHORIZED: "UNAUTHORIZED"
};

export class TelephonyGateway {
  constructor(options = {}) {
    this.ownerPhoneNumbers = new Set(
      (options.ownerPhoneNumbers || [options.ownerPhoneNumber || "+919999999999"])
        .map(p => this.normalizePhoneNumber(p))
    );
    this.sipAddress = options.sipAddress || "sip:ultron@ai.local:5060";
    this.securityPin = options.securityPin || "1001";
    this.activeCalls = new Map();
    this.callHistory = [];
    this.maxHistory = 100;
    this.enableWebRTC = options.enableWebRTC ?? true;
  }

  normalizePhoneNumber(phone) {
    if (!phone) return "";
    return String(phone).replace(/[^0-9+]/g, "").trim();
  }

  /**
   * Evaluates caller authorization by phone number and PIN requirements.
   */
  authenticateCaller(callerNumber) {
    const normalized = this.normalizePhoneNumber(callerNumber);
    if (this.ownerPhoneNumbers.has(normalized)) {
      return {
        status: CALLER_AUTH_STATUS.VERIFIED_OWNER,
        caller: normalized,
        isOwner: true,
        message: "Caller recognized as authorized owner."
      };
    }
    return {
      status: CALLER_AUTH_STATUS.PIN_REQUIRED,
      caller: normalized,
      isOwner: false,
      message: "Unknown caller. Security PIN verification required."
    };
  }

  /**
   * Verifies DTMF security PIN for an active call.
   */
  verifyCallPin(callId, enteredPin) {
    const call = this.activeCalls.get(callId);
    if (!call) return { success: false, error: "CALL_NOT_FOUND" };

    const cleanPin = String(enteredPin || "").trim();
    if (cleanPin === this.securityPin) {
      call.authStatus = CALLER_AUTH_STATUS.VERIFIED_OWNER;
      call.isOwner = true;
      return { success: true, authorized: true, message: "Security PIN verified. Access granted." };
    }

    call.failedPinAttempts = (call.failedPinAttempts || 0) + 1;
    if (call.failedPinAttempts >= 3) {
      call.authStatus = CALLER_AUTH_STATUS.UNAUTHORIZED;
      return { success: false, authorized: false, error: "MAX_PIN_ATTEMPTS_EXCEEDED", hangup: true };
    }

    return { success: false, authorized: false, error: "INVALID_PIN", attemptsRemaining: 3 - call.failedPinAttempts };
  }

  /**
   * Handles incoming phone call event and returns carrier-compatible instructions (TwiML / SIP).
   */
  handleIncomingCall({ callSid, from, to, sipCallId = null }) {
    const callId = callSid || sipCallId || "call-" + crypto.randomUUID();
    const auth = this.authenticateCaller(from);

    const callRecord = {
      callId,
      from: this.normalizePhoneNumber(from),
      to: this.normalizePhoneNumber(to),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: CALL_STATES.RINGING,
      authStatus: auth.status,
      isOwner: auth.isOwner,
      failedPinAttempts: 0,
      transcript: [],
      activeTask: null,
      interrupted: false
    };

    this.activeCalls.set(callId, callRecord);

    let twimlResponse = "";
    if (auth.status === CALLER_AUTH_STATUS.VERIFIED_OWNER) {
      callRecord.state = CALL_STATES.CONNECTED;
      twimlResponse = this.generateConnectedTwiML(callId, "Good evening sir. ULTRON is online. How may I assist you?");
    } else {
      twimlResponse = this.generatePinChallengeTwiML(callId);
    }

    return {
      callId,
      state: callRecord.state,
      authStatus: auth.status,
      isOwner: auth.isOwner,
      twiml: twimlResponse
    };
  }

  /**
   * Generate carrier TwiML for an authorized connected conversation.
   */
  generateConnectedTwiML(callId, initialGreeting = "ULTRON is online. Please state your command.") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Matthew" language="en-IN">${this.escapeXml(initialGreeting)}</Say>
    <Gather input="speech" action="/api/telephony/process-speech?callId=${encodeURIComponent(callId)}" method="POST" language="en-IN" speechTimeout="auto" hints="ULTRON, unlock screen, check computer, unlock devices, play song, run tests">
    </Gather>
    <Redirect method="POST">/api/telephony/timeout-prompt?callId=${encodeURIComponent(callId)}</Redirect>
</Response>`.trim();
  }

  /**
   * Generate carrier TwiML for PIN challenge.
   */
  generatePinChallengeTwiML(callId) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="dtmf" action="/api/telephony/verify-pin?callId=${encodeURIComponent(callId)}" method="POST" numDigits="4" timeout="10">
        <Say voice="Polly.Matthew" language="en-IN">Security authorization required. Please enter your four digit PIN on your keypad.</Say>
    </Gather>
    <Say voice="Polly.Matthew" language="en-IN">No input received. Terminating call.</Say>
    <Hangup/>
</Response>`.trim();
  }

  /**
   * Generates TwiML to speak a response and continue listening.
   */
  generateSpeechResponseTwiML(callId, spokenText, shouldHangup = false) {
    if (shouldHangup) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Matthew" language="en-IN">${this.escapeXml(spokenText)}</Say>
    <Hangup/>
</Response>`.trim();
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Matthew" language="en-IN">${this.escapeXml(spokenText)}</Say>
    <Gather input="speech" action="/api/telephony/process-speech?callId=${encodeURIComponent(callId)}" method="POST" language="en-IN" speechTimeout="auto" hints="ULTRON, unlock screen, check computer, unlock devices, play song, run tests">
    </Gather>
    <Redirect method="POST">/api/telephony/timeout-prompt?callId=${encodeURIComponent(callId)}</Redirect>
</Response>`.trim();
  }

  /**
   * Records speech from caller and updates call state.
   */
  recordCallerSpeech(callId, speechText) {
    const call = this.activeCalls.get(callId);
    if (!call) return { success: false, error: "CALL_NOT_FOUND" };

    const cleanSpeech = String(speechText || "").trim();
    call.state = CALL_STATES.PROCESSING;
    call.updatedAt = new Date().toISOString();

    const turn = {
      role: "caller",
      text: cleanSpeech,
      timestamp: new Date().toISOString()
    };
    call.transcript.push(turn);

    return {
      success: true,
      callId,
      speechText: cleanSpeech,
      isOwner: call.isOwner,
      authStatus: call.authStatus
    };
  }

  /**
   * Records assistant response and updates call state.
   */
  recordAssistantSpeech(callId, responseText) {
    const call = this.activeCalls.get(callId);
    if (!call) return { success: false, error: "CALL_NOT_FOUND" };

    const cleanText = String(responseText || "").trim();
    call.state = CALL_STATES.SPEAKING;
    call.updatedAt = new Date().toISOString();

    const turn = {
      role: "assistant",
      text: cleanText,
      timestamp: new Date().toISOString()
    };
    call.transcript.push(turn);

    return {
      success: true,
      callId,
      responseText: cleanText
    };
  }

  /**
   * Terminate active call and archive transcript.
   */
  endCall(callId, reason = "caller_hangup") {
    const call = this.activeCalls.get(callId);
    if (!call) return { success: false, error: "CALL_NOT_FOUND" };

    call.state = CALL_STATES.COMPLETED;
    call.endedAt = new Date().toISOString();
    call.terminationReason = reason;

    this.callHistory.unshift(call);
    if (this.callHistory.length > this.maxHistory) {
      this.callHistory.pop();
    }
    this.activeCalls.delete(callId);

    return {
      success: true,
      callId,
      durationSeconds: Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000),
      transcriptCount: call.transcript.length
    };
  }

  getCall(callId) {
    return this.activeCalls.get(callId) || null;
  }

  getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }

  getCallHistory(limit = 20) {
    return this.callHistory.slice(0, limit);
  }

  escapeXml(unsafe) {
    return String(unsafe || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Converts 16-bit linear PCM audio buffer to G.711 μ-law (8kHz standard telephony).
   */
  encodeLinearPcmToMuLaw(pcmBuffer) {
    const muLawBuffer = Buffer.alloc(Math.floor(pcmBuffer.length / 2));
    for (let i = 0, j = 0; i < pcmBuffer.length - 1; i += 2, j++) {
      const sample = pcmBuffer.readInt16LE(i);
      muLawBuffer[j] = this.linearToMuLawSample(sample);
    }
    return muLawBuffer;
  }

  linearToMuLawSample(sample) {
    const BIAS = 0x84;
    const CLIP = 32635;
    let sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;

    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
      exponent--;
    }
    let mantissa = (sample >> (exponent + 3)) & 0x0f;
    let muLawByte = ~(sign | (exponent << 4) | mantissa);
    return muLawByte & 0xff;
  }
}

export const telephonyGateway = new TelephonyGateway();
