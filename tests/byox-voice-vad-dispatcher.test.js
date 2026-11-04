import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxVoiceVadDispatcher } from '../voice/byox-voice-vad-dispatcher.js';

test('ByoxVoiceVadDispatcher: compute RMS energy and distinguish speech from silence', () => {
  const dispatcher = new ByoxVoiceVadDispatcher({ speechThresholdMultiplier: 2.0 });

  // Generate 16-bit silence buffer (low amplitude)
  const silenceBuf = Buffer.alloc(3200); // 100ms at 16kHz (16-bit)
  for (let i = 0; i < 1600; i++) {
    silenceBuf.writeInt16LE(Math.floor((Math.random() - 0.5) * 50), i * 2);
  }

  // Generate speech buffer (high amplitude wave)
  const speechBuf = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) {
    const val = Math.floor(Math.sin(i / 10) * 8000);
    speechBuf.writeInt16LE(val, i * 2);
  }

  const silenceResult = dispatcher.processAudioChunk(silenceBuf);
  assert.equal(silenceResult.isSpeech, false);

  const speechResult = dispatcher.processAudioChunk(speechBuf);
  assert.equal(speechResult.isSpeech, true);
  assert.ok(speechResult.rms > silenceResult.rms);
});

test('ByoxVoiceVadDispatcher: proactive queue priority ordering and quiet hours', () => {
  const dispatcher = new ByoxVoiceVadDispatcher({
    quietHours: { enabled: true, startHour: 22, endHour: 8 },
    minDispatchGapMs: 0
  });

  dispatcher.enqueueProactiveMessage('Low priority system note', 'LOW');
  dispatcher.enqueueProactiveMessage('Urgent security alert', 'URGENT');
  dispatcher.enqueueProactiveMessage('Normal calendar reminder', 'NORMAL');

  // Test during quiet hours (e.g. 23:00)
  const quietDate = new Date();
  quietDate.setHours(23, 0, 0, 0);

  const nextMsg = dispatcher.pollNextDispatch(quietDate);
  assert.ok(nextMsg);
  assert.equal(nextMsg.priority, 'URGENT');
  assert.equal(nextMsg.text, 'Urgent security alert');

  // Second poll during quiet hours should return null because only non-urgent remain
  const secondMsg = dispatcher.pollNextDispatch(quietDate);
  assert.equal(secondMsg, null);

  // Poll during daytime (e.g. 14:00) should permit NORMAL message
  const daytimeDate = new Date();
  daytimeDate.setHours(14, 0, 0, 0);

  const normalMsg = dispatcher.pollNextDispatch(daytimeDate);
  assert.ok(normalMsg);
  assert.equal(normalMsg.priority, 'NORMAL');
});
