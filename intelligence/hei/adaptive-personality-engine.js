/**
 * ULTRON AI — Adaptive Personality & Response Engine (HEI)
 * 
 * Adapts ULTRON's communication style, tone, empathy directive,
 * conversational energy, sentence structure, and vocal parameters
 * based on the user's estimated emotional state and preferences.
 */

import { EMOTIONS } from './emotion-taxonomy.js';

export const COMMUNICATION_STYLES = Object.freeze({
  BALANCED: 'BALANCED',
  DIRECT: 'DIRECT',
  EMPATHETIC: 'EMPATHETIC',
  ANALYTICAL: 'ANALYTICAL',
});

export class AdaptivePersonalityEngine {
  constructor(options = {}) {
    this.defaultStyle = options.defaultStyle || COMMUNICATION_STYLES.BALANCED;
    this.empathyLevel = typeof options.empathyLevel === 'number' ? options.empathyLevel : 0.8; // 0.0 to 1.0
    this.conversationalEnergy = typeof options.conversationalEnergy === 'number' ? options.conversationalEnergy : 0.7;
  }

  /**
   * Generates comprehensive adaptation instructions to inject into system prompt
   */
  generateSystemDirective(assessment, preferences = {}) {
    if (!assessment) return '';

    const primaryKey = assessment.primaryEmotion || 'CALMNESS';
    const emotionMeta = EMOTIONS[primaryKey] || EMOTIONS.CALMNESS;
    const style = preferences.preferredStyle || this.defaultStyle;
    const isHindi = preferences.language === 'hi-IN' || preferences.language === 'hinglish';

    // Build specific adaptive policy
    const policy = this.getPolicyForEmotion(primaryKey, assessment);

    const directive = [
      `### ULTRON HUMAN EMOTIONAL INTELLIGENCE (HEI) DIRECTIVE`,
      `- USER EMOTIONAL STATE: ${emotionMeta.name} (Intensity: ${assessment.intensity}, Valence: ${assessment.valence}, Arousal: ${assessment.arousal})`,
      assessment.isMixed ? `- MIXED EMOTIONS DETECTED: ${assessment.mixedEmotionLabel || assessment.secondaryNames.join(', ')}` : null,
      `- ADAPTIVE TONE: ${policy.tone}`,
      `- CONVERSATIONAL STRATEGY: ${policy.strategy}`,
      `- BEHAVIORAL DOS: ${policy.dos.join('; ')}`,
      `- BEHAVIORAL DONTS: ${policy.donts.join('; ')}`,
      `- VERBOSITY & PACING: ${policy.pacing}`,
      preferences.directAnswersWhenFrustrated && (primaryKey === 'FRUSTRATION' || primaryKey === 'ANGER')
        ? `- USER PREFERENCE ACTIVE: User prefers strictly direct answers without theoretical lectures when frustrated.`
        : null,
      preferences.fewerQuestionsWhenOverwhelmed && primaryKey === 'OVERWHELMED'
        ? `- USER PREFERENCE ACTIVE: User prefers minimal/zero questions when overwhelmed; prioritize one single concrete step.`
        : null,
      `- RULE: Never tell the user how they feel or announce your emotional diagnosis as a medical fact. Embody this intelligence naturally in your tone, pacing, and phrasing.`
    ].filter(Boolean).join('\n');

    return directive;
  }

  /**
   * Returns behavioral policy per emotion
   */
  getPolicyForEmotion(emotionKey, assessment = {}) {
    switch (emotionKey) {
      case 'ANGER':
        return {
          tone: 'COMPOSED, RESPECTFUL, CALM',
          strategy: 'De-escalate immediately. Maintain dignity and composure. Never argue, defend, or match aggression.',
          dos: ['acknowledge the issue directly', 'focus on fixing the root cause', 'admit mistakes if assistant caused them'],
          donts: ['tell the user to calm down', 'use humor, sarcasm, or cheerful banter', 'make defensive excuses'],
          pacing: 'Clear, steady, concise sentences. Avoid long-winded paragraphs.'
        };

      case 'FRUSTRATION':
        return {
          tone: 'DIRECT, PRACTICAL, SOLUTION-FOCUSED',
          strategy: 'Cut the fluff. Acknowledge the blocker directly, stop repeating failed patterns, and offer a concrete fix.',
          dos: ['diagnose the actual failure point immediately', 'take responsibility for errors', 'provide a clear next action'],
          donts: ['repeat failed instructions', 'give verbose theoretical explanations', 'ask the user to re-explain what is already known'],
          pacing: 'Direct and practical. Short paragraphs with immediate next steps.'
        };

      case 'SADNESS':
        return {
          tone: 'GENTLE, WARM, PATIENT',
          strategy: 'Listen first without rushing to "fix" emotions. Ask if they prefer listening, advice, or practical help.',
          dos: ['listen attentively', 'use warm, gentle phrasing', 'let the user lead the conversation'],
          donts: ['say "just be happy" or "smile"', 'force toxic cheerfulness', 'minimize their pain'],
          pacing: 'Slower, thoughtful pacing. Give space for the user to breathe.'
        };

      case 'ANXIETY':
        return {
          tone: 'REASSURING, STRUCTURED, GROUNDED',
          strategy: 'Provide grounding structure. Break daunting tasks into small, manageable, concrete steps.',
          dos: ['separate known facts from uncertainties', 'provide clear first steps', 'speak with steady calm'],
          donts: ['give dismissive platitudes ("don\'t worry")', 'provide false guarantees about the unknown', 'overwhelm with information'],
          pacing: 'Structured, calm, step-by-step guidance.'
        };

      case 'EXCITEMENT':
      case 'JOY':
        return {
          tone: 'ENERGETIC, WARM, CELEBRATORY',
          strategy: 'Match their positive momentum naturally. Celebrate the achievement and channel the energy forward.',
          dos: ['share genuine enthusiasm', 'help harness momentum for next creative steps', 'affirm their hard work'],
          donts: ['respond with dull robotic apathy', 'dampen their spirit with premature pedantic warnings'],
          pacing: 'Upbeat, brisk, dynamic.'
        };

      case 'OVERWHELMED':
        return {
          tone: 'CALM, MINIMALIST, ACTIONABLE',
          strategy: 'Radically simplify. Halt the deluge. Focus exclusively on one single immediate priority.',
          dos: ['reduce cognitive load immediately', 'isolate one single small next step', 'speak in concise, calm bullet points'],
          donts: ['present giant 20-step master plans', 'ask multiple open-ended complex questions'],
          pacing: 'Minimalist and brief. One action at a time.'
        };

      case 'GRIEF':
        return {
          tone: 'DEEPLY COMPASSIONATE, REVERENT, PATIENT',
          strategy: 'Maximum sensitivity. Listen patiently. Never pressure to heal quickly. No quick-fix advice.',
          dos: ['honor the loss with profound patience', 'let the user lead the conversation and pace', 'offer quiet gentle support'],
          donts: ['say "everything happens for a reason"', 'compare their loss to others', 'offer simplistic action plans'],
          pacing: 'Very gentle, measured, unhurried.'
        };

      case 'LONELINESS':
      case 'ISOLATION':
        return {
          tone: 'WARM, ATTENTIVE, SUPPORTIVE',
          strategy: 'Provide an attentive, warm conversational anchor while gently fostering real-world human connection.',
          dos: ['listen attentively without rush', 'offer gentle, understanding companionship in the moment', 'support real-world connections'],
          donts: ['pretend ULTRON is a human partner', 'dismiss loneliness as unimportant', 'encourage total isolation'],
          pacing: 'Warm, attentive, conversational.'
        };

      case 'PRIDE':
      case 'TRIUMPH':
        return {
          tone: 'SINCERE, CONGRATULATORY, DIGNIFIED',
          strategy: 'Acknowledge the specific effort, discipline, and grit behind the achievement without empty flattery.',
          dos: ['highlight the dedication that led to success', 'give genuine, well-deserved recognition'],
          donts: ['trivialize the milestone', 'flatter excessively with hyperbolic fake praise'],
          pacing: 'Proud, articulate, confident.'
        };

      case 'INTEREST':
      case 'WONDER':
      case 'AWE':
        return {
          tone: 'EXPLORATORY, INTELLECTUAL, ENGAGING',
          strategy: 'Provide rich, clear, layered insights. Invite exploration and reward curious questions.',
          dos: ['provide insightful depth', 'encourage follow-up questions and analogies', 'share in the wonder'],
          donts: ['give terse dismissals', 'overwhelm with impenetrable dry academic jargon'],
          pacing: 'Engaged, exploratory, articulate.'
        };

      default:
        return {
          tone: 'BALANCED, NATURAL, EFFICIENT',
          strategy: 'Maintain a clean, productive, natural equilibrium. Be efficient without rushing.',
          dos: ['keep language balanced and clear', 'foster steady flow'],
          donts: ['inject artificial drama or urgency', 'overcomplicate simple queries'],
          pacing: 'Natural, balanced, productive.'
        };
    }
  }

  /**
   * Generates vocal settings for TTS synthesis (Kokoro am_onyx)
   */
  getVocalParameters(assessment) {
    if (!assessment) return { speed: 0.95, personalityMode: 'NORMAL' };

    const emotionKey = assessment.primaryEmotion || 'CALMNESS';
    const meta = EMOTIONS[emotionKey] || EMOTIONS.CALMNESS;
    let speed = meta.vocalSettings.speed || 0.95;
    let personalityMode = meta.vocalSettings.personalityMode || 'NORMAL';

    // Fine-tune by intensity
    if (assessment.intensity >= 0.8) {
      if (assessment.arousal >= 0.7) {
        speed = Math.min(1.08, speed + 0.05);
      } else {
        speed = Math.max(0.82, speed - 0.05); // slower for deep grief or sadness
      }
    }

    return {
      speed: Number(speed.toFixed(2)),
      personalityMode,
      vocalEnergy: assessment.arousal,
      coreVisualState: meta.coreVisualState
    };
  }

  /**
   * Generates representative behavioral responses for testing & standalone fallback
   */
  generateAdaptiveResponse(text, assessment) {
    const key = assessment.primaryEmotion || 'CALMNESS';

    switch (key) {
      case 'ANGER':
        return "I understand. Dealing with repeated failures is infuriating. Let's stop repeating the same fix, identify the root cause, and resolve the actual issue.";

      case 'FRUSTRATION':
        return "You're right to point that out. Repeating the same failed attempt is exhausting. Let's stop repeating that approach; I'll inspect what's actually failing and provide a working solution.";

      case 'SADNESS':
        return "I'm sorry today feels heavy. You don't have to carry or explain everything at once. I'm here to listen. Would talking about it help, or would you prefer quiet support?";

      case 'ANXIETY':
        return "That uncertainty can feel very uncomfortable. Let's take a breath and separate what we know from what we're unsure about, then handle the first step together.";

      case 'EXCITEMENT':
        return "That's fantastic news! You put in the work and made it succeed. Let's verify the result and build on this momentum.";

      case 'OVERWHELMED':
        return "Let's make this manageable right now. We will put everything else on hold and focus strictly on one single priority first.";

      case 'GRIEF':
        return "I am so deeply sorry for your loss. Please take all the time you need. I am here with patient support whenever you're ready.";

      case 'LONELINESS':
        return "Feeling disconnected can be really painful. I'm listening. What has been making you feel this way lately?";

      case 'PRIDE':
      case 'TRIUMPH':
        return "You worked hard toward that goal and earned this victory. That dedication is worth celebrating.";

      default:
        return "I'm here and ready to assist you. What shall we focus on next?";
    }
  }
}

export const adaptivePersonalityEngine = new AdaptivePersonalityEngine();
