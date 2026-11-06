/**
 * ULTRON AI — Telephony Conversational Intelligence & Intent Dispatcher
 * Project Codename: ULTRON ETERNAL
 *
 * Connects telephone calls to the ULTRON AI brain:
 * - Natural multilingual voice comprehension (Hindi, Hinglish, English).
 * - Conversational intent classification:
 *   - Screen lock / unlock commands (PC)
 *   - Multi-device mobile unlock commands (Android)
 *   - Synchronized media playback (YouTube song playback across multiple devices)
 *   - Remote PC project checks & test runner execution
 *   - System resource / storage / battery inquiries
 *   - General conversational assistance via BrainRouter
 * - Dispatches commands to Windows Desktop Agent and Multi-Device Manager.
 * - Generates crisp, authoritative spoken replies formatted for carrier telephony.
 */

export const TELEPHONY_INTENTS = {
  UNLOCK_PC_SCREEN: "UNLOCK_PC_SCREEN",
  LOCK_PC_SCREEN: "LOCK_PC_SCREEN",
  UNLOCK_MOBILE_DEVICES: "UNLOCK_MOBILE_DEVICES",
  PLAY_MEDIA_ALL_DEVICES: "PLAY_MEDIA_ALL_DEVICES",
  CHECK_PROJECT_TESTS: "CHECK_PROJECT_TESTS",
  CHECK_SYSTEM_VITALS: "CHECK_SYSTEM_VITALS",
  SEARCH_DRIVE: "SEARCH_DRIVE",
  CREATE_CINEMATIC_EDIT: "CREATE_CINEMATIC_EDIT",
  STOP_RENDERING: "STOP_RENDERING",
  OPEN_FINAL_VIDEO: "OPEN_FINAL_VIDEO",
  ORGANIZE_FOLDER: "ORGANIZE_FOLDER",
  CHECK_SYSTEM_PERFORMANCE: "CHECK_SYSTEM_PERFORMANCE",
  GENERAL_CONVERSATION: "GENERAL_CONVERSATION",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  UNAUTHORIZED_COMMAND: "UNAUTHORIZED_COMMAND"
};

export class TelephonyBrain {
  constructor(options = {}) {
    this.brainRouter = options.brainRouter || null;
    this.multiDeviceManager = options.multiDeviceManager || null;
    this.windowsDesktopAgent = options.windowsDesktopAgent || null;
    this.remoteTaskOrchestrator = options.remoteTaskOrchestrator || null;
  }

  /**
   * Detects whether text is predominantly English, Hindi, or conversational Hinglish.
   */
  detectLanguage(text = "") {
    const clean = String(text).toLowerCase();
    const hindiWords = ["namaste", "kaise", "kya", "karo", "kardo", "mera", "meri", "kholo", "bhai", "kripya", "suno", "theek", "hai", "karo na", "sab", "gaana"];
    const devanagariRegex = /[\u0900-\u097F]/;

    if (devanagariRegex.test(clean)) {
      return { language: "hi-IN", dialect: "hindi_devanagari" };
    }

    const matches = hindiWords.filter(w => new RegExp(`\\b${w}\\b`, "i").test(clean));
    if (matches.length > 0) {
      return { language: "hi-IN", dialect: "hinglish_conversational" };
    }

    return { language: "en-IN", dialect: "english" };
  }

  /**
   * Classifies intent from natural spoken speech.
   */
  classifyIntent(speechText = "") {
    const text = String(speechText).toLowerCase().trim();

    // 1. PC Screen Unlock / Lock
    if (
      (text.includes("unlock") && (text.includes("screen") || text.includes("computer") || text.includes("pc") || text.includes("monitor"))) &&
      !text.includes("mobile") && !text.includes("phone")
    ) {
      return { intent: TELEPHONY_INTENTS.UNLOCK_PC_SCREEN, target: "windows_pc", confidence: 0.95 };
    }
    if (
      (text.includes("lock") && (text.includes("screen") || text.includes("computer") || text.includes("pc"))) &&
      !text.includes("unlock")
    ) {
      return { intent: TELEPHONY_INTENTS.LOCK_PC_SCREEN, target: "windows_pc", confidence: 0.95 };
    }

    // 2. Multi-Device Mobile Unlock
    if (
      (text.includes("unlock") || text.includes("kholo")) &&
      (text.includes("mobile") || text.includes("phone") || text.includes("devices") || text.includes("all three"))
    ) {
      return { intent: TELEPHONY_INTENTS.UNLOCK_MOBILE_DEVICES, target: "all_mobile_devices", confidence: 0.96 };
    }

    // 3. Play Media / Favorite Song on All Devices
    if (
      (text.includes("play") || text.includes("chalao") || text.includes("gaana") || text.includes("song")) &&
      (text.includes("song") || text.includes("music") || text.includes("video") || text.includes("favorite"))
    ) {
      return {
        intent: TELEPHONY_INTENTS.PLAY_MEDIA_ALL_DEVICES,
        target: "all_devices",
        mediaQuery: "favorite song",
        confidence: 0.94
      };
    }

    // 4. System Vitals & Storage
    if (
      text.includes("storage") || text.includes("space") || text.includes("battery") ||
      text.includes("ram") || text.includes("cpu") || text.includes("vitals") || text.includes("specs")
    ) {
      return { intent: TELEPHONY_INTENTS.CHECK_SYSTEM_VITALS, target: "windows_pc", confidence: 0.93 };
    }

    // 5. System Performance & Health
    if (text.includes("performance") || (text.includes("system") && text.includes("health"))) {
      return { intent: TELEPHONY_INTENTS.CHECK_SYSTEM_PERFORMANCE, target: "windows_pc", confidence: 0.94 };
    }

    // 6. Stop Rendering
    if ((text.includes("stop") || text.includes("cancel")) && (text.includes("render") || text.includes("rendering") || text.includes("export"))) {
      return { intent: TELEPHONY_INTENTS.STOP_RENDERING, target: "video_editor", confidence: 0.95 };
    }

    // 7. Open Final Video
    if ((text.includes("open") || text.includes("play") || text.includes("show")) && (text.includes("final video") || text.includes("exported video") || text.includes("rendered video"))) {
      return { intent: TELEPHONY_INTENTS.OPEN_FINAL_VIDEO, target: "video_editor", confidence: 0.94 };
    }

    // 8. Create Cinematic Edit / Mystery Reel / Action Edit
    if (text.includes("cinematic") || text.includes("action edit") || text.includes("mystery reel") || (text.includes("create") && (text.includes("edit") || text.includes("reel")))) {
      return { intent: TELEPHONY_INTENTS.CREATE_CINEMATIC_EDIT, target: "autonomous_production", confidence: 0.95 };
    }

    // 9. Organize Folder
    if ((text.includes("organize") || text.includes("clean")) && (text.includes("folder") || text.includes("download") || text.includes("downloads") || text.includes("desktop"))) {
      return { intent: TELEPHONY_INTENTS.ORGANIZE_FOLDER, target: "system_control", confidence: 0.94 };
    }

    // 10. Search Drive & Media Files
    if ((text.includes("search") || text.includes("find")) && (text.includes("drive") || text.includes("videos") || text.includes("footage") || text.includes("images") || text.includes("photos") || text.includes("files"))) {
      return { intent: TELEPHONY_INTENTS.SEARCH_DRIVE, target: "media_discovery", confidence: 0.93 };
    }

    // 11. Project Check & Test Runner (English & Hinglish)
    if (
      (text.includes("check") || text.includes("open") || text.includes("run") || text.includes("find")) &&
      (text.includes("project") || text.includes("test") || text.includes("ultron ai") || text.includes("failing") || text.includes("code") || text.includes("computer") || text.includes("pc"))
    ) {
      return { intent: TELEPHONY_INTENTS.CHECK_PROJECT_TESTS, target: "windows_pc", confidence: 0.92 };
    }

    return { intent: TELEPHONY_INTENTS.GENERAL_CONVERSATION, target: "llm_brain", confidence: 0.85 };
  }

  /**
   * Processes caller speech, executes permitted actions on connected devices, and returns spoken reply.
   */
  async processCallerUtterance({ callId, callerNumber, isOwner, speechText, multiDeviceManager, windowsDesktopAgent }) {
    const lang = this.detectLanguage(speechText);
    const classification = this.classifyIntent(speechText);

    if (!isOwner) {
      return {
        permitted: false,
        intent: TELEPHONY_INTENTS.UNAUTHORIZED_COMMAND,
        spokenResponse: "Access denied. This telephone number is not authorized to control connected systems.",
        hangup: true
      };
    }

    const mdm = multiDeviceManager || this.multiDeviceManager;
    const wda = windowsDesktopAgent || this.windowsDesktopAgent;

    switch (classification.intent) {
      case TELEPHONY_INTENTS.UNLOCK_PC_SCREEN: {
        const unlockResult = wda
          ? await wda.unlockScreen()
          : {
              success: false,
              error: "WINDOWS_AGENT_UNAVAILABLE",
              message: "Windows desktop companion is not connected."
            };
        const unlocked = unlockResult?.success === true;
        return {
          permitted: true,
          intent: classification.intent,
          executed: unlocked,
          spokenResponse: unlocked
            ? "The workstation is unlocked."
            : unlockResult?.error === "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION"
              ? "I cannot bypass Windows sign-in. Unlock the PC locally, then reconnect ULTRON."
              : "I could not unlock the workstation because the Windows companion did not confirm the action.",
          details: unlockResult
        };
      }

      case TELEPHONY_INTENTS.LOCK_PC_SCREEN: {
        const lockResult = wda
          ? await wda.lockScreen()
          : {
              success: false,
              error: "WINDOWS_AGENT_UNAVAILABLE",
              message: "Windows desktop companion is not connected."
            };
        const physicallyLocked = lockResult?.success === true && lockResult?.simulated !== true;
        return {
          permitted: true,
          intent: classification.intent,
          executed: physicallyLocked,
          spokenResponse: physicallyLocked
            ? "Windows confirmed that the workstation is locked."
            : lockResult?.success === true && lockResult?.simulated === true
              ? "The lock request was simulated. No physical Windows workstation was locked."
              : "I could not confirm that the workstation was locked.",
          details: lockResult
        };
      }

      case TELEPHONY_INTENTS.UNLOCK_MOBILE_DEVICES: {
        const mobileResult = mdm
          ? await mdm.unlockMobileDevices()
          : {
              success: false,
              error: "MULTI_DEVICE_MANAGER_UNAVAILABLE",
              message: "The multi-device manager is not configured."
            };
        const unlockedCount = Number.isFinite(mobileResult?.unlockedCount) ? mobileResult.unlockedCount : 0;
        const totalTargeted = Number.isFinite(mobileResult?.targetedCount)
          ? mobileResult.targetedCount
          : Number.isFinite(mobileResult?.totalTargeted)
            ? mobileResult.totalTargeted
            : unlockedCount;
        const succeeded = unlockedCount > 0;
        const spokenResponse = unlockedCount === 0
          ? "No mobile devices confirmed an unlock. " + (mobileResult?.message || mobileResult?.error || "")
          : unlockedCount < totalTargeted
            ? `ULTRON unlocked ${unlockedCount} of ${totalTargeted} targeted mobile devices. The remaining devices did not confirm the action.`
            : `ULTRON unlocked ${unlockedCount} mobile devices.`;
        return {
          permitted: true,
          intent: classification.intent,
          executed: succeeded,
          spokenResponse,
          details: mobileResult
        };
      }

      case TELEPHONY_INTENTS.PLAY_MEDIA_ALL_DEVICES: {
        const mediaResult = mdm
          ? await mdm.playMediaAcrossDevices({
              query: classification.mediaQuery || "favorite song"
            })
          : {
              success: false,
              error: "MULTI_DEVICE_MANAGER_UNAVAILABLE",
              message: "The multi-device manager is not configured."
            };
        const playingDevices = Number.isFinite(mediaResult?.playingDevices) ? mediaResult.playingDevices : 0;
        const targetedCount = Number.isFinite(mediaResult?.targetedCount)
          ? mediaResult.targetedCount
          : Array.isArray(mediaResult?.devices)
            ? mediaResult.devices.length
            : playingDevices;
        const executed = playingDevices > 0;
        return {
          permitted: true,
          intent: classification.intent,
          executed,
          spokenResponse: playingDevices === 0
            ? "I could not confirm media playback on any connected device."
            : playingDevices < targetedCount
              ? `Media playback started on ${playingDevices} of ${targetedCount} targeted devices. Some devices did not confirm playback.`
              : `Media playback started on ${playingDevices} devices.`,
          details: mediaResult
        };
      }

      case TELEPHONY_INTENTS.CHECK_PROJECT_TESTS: {
        const projectResult = wda
          ? await wda.checkProjectStatus()
          : {
              success: false,
              error: "WINDOWS_AGENT_UNAVAILABLE",
              message: "Windows desktop companion is not connected."
            };
        const inspected = projectResult?.success === true;
        return {
          permitted: true,
          intent: classification.intent,
          executed: inspected,
          spokenResponse: inspected
            ? "Connecting to your authorized computer. I inspected the ULTRON AI repository metadata. The automated test suite was not run, so I cannot claim that tests are passing."
            : "I could not inspect the ULTRON AI project because the Windows companion is unavailable.",
          details: projectResult
        };
      }

      case TELEPHONY_INTENTS.CHECK_SYSTEM_VITALS: {
        const vitals = wda
          ? await wda.getSystemVitals()
          : {
              success: false,
              error: "WINDOWS_AGENT_UNAVAILABLE",
              message: "Windows desktop companion is not connected."
            };
        const storageAvailableGb = typeof vitals?.storageAvailableGb === "number" &&
          Number.isFinite(vitals.storageAvailableGb) && vitals.storageAvailableGb >= 0
          ? vitals.storageAvailableGb
          : null;
        const freeRamGb = typeof vitals?.freeRamGb === "number" && Number.isFinite(vitals.freeRamGb)
          ? vitals.freeRamGb
          : null;
        const measured = vitals?.success !== false;
        const facts = [];
        if (storageAvailableGb !== null) facts.push(`${storageAvailableGb} gigabytes of free storage`);
        if (freeRamGb !== null) facts.push(`${freeRamGb} gigabytes of free RAM`);
        return {
          permitted: true,
          intent: classification.intent,
          executed: measured,
          spokenResponse: measured
            ? facts.length
              ? `The connected computer reports ${facts.join(" and ")}. These are hardware readings, not a full readiness assessment.`
              : "The computer responded, but free storage and memory could not be measured."
            : "I could not collect computer vitals because the Windows companion is unavailable.",
          details: { ...vitals, storageAvailableGb }
        };
      }

      case TELEPHONY_INTENTS.SEARCH_DRIVE: {
        const query = String(speechText || "").trim();
        const searchResult = this.remoteTaskOrchestrator
          ? await this.remoteTaskOrchestrator.executeRemoteTask({
              callerId: callId || callerNumber || "telephony-owner",
              isOwner: true,
              action: "FIND_PC_FILE",
              payload: { query }
            })
          : {
              success: false,
              error: "REMOTE_TASK_ORCHESTRATOR_UNAVAILABLE",
              message: "The remote PC task service is not configured."
            };
        const matches = searchResult?.result?.matches;
        return {
          permitted: true,
          intent: classification.intent,
          executed: searchResult?.success === true,
          spokenResponse: searchResult?.success === true
            ? Array.isArray(matches) && matches.length
              ? `The PC search found ${matches.length} matching files.`
              : "The PC search completed and found no matching files."
            : "I could not search the PC because the remote file-search service is unavailable or failed.",
          details: searchResult
        };
      }

      case TELEPHONY_INTENTS.CREATE_CINEMATIC_EDIT:
      case TELEPHONY_INTENTS.STOP_RENDERING:
      case TELEPHONY_INTENTS.OPEN_FINAL_VIDEO:
      case TELEPHONY_INTENTS.ORGANIZE_FOLDER: {
        const unavailable = {
          success: false,
          error: "CAPABILITY_EXECUTOR_NOT_CONNECTED",
          message: "This voice intent is classified, but no execution adapter is connected to it yet."
        };
        return {
          permitted: true,
          intent: classification.intent,
          executed: false,
          spokenResponse: "I understood the request, but the execution service for this action is not connected. I have not changed any files or tasks.",
          details: unavailable
        };
      }

      case TELEPHONY_INTENTS.CHECK_SYSTEM_PERFORMANCE: {
        const vitals = wda
          ? await wda.getSystemVitals()
          : {
              success: false,
              error: "WINDOWS_AGENT_UNAVAILABLE",
              message: "Windows desktop companion is not connected."
            };
        const measured = vitals?.success !== false;
        const ramUsedPercent = typeof vitals?.ramUsedPercent === "number" && Number.isFinite(vitals.ramUsedPercent)
          ? vitals.ramUsedPercent
          : null;
        return {
          permitted: true,
          intent: classification.intent,
          executed: measured,
          spokenResponse: !measured
            ? "I could not measure system performance because the Windows companion is unavailable."
            : ramUsedPercent !== null
              ? `The computer reports RAM usage at ${ramUsedPercent} percent. I do not have enough telemetry to label overall system performance as optimal.`
              : "The computer responded, but no usable performance metrics were returned.",
          details: vitals
        };
      }

      case TELEPHONY_INTENTS.GENERAL_CONVERSATION:
      default: {
        const lower = speechText.toLowerCase();
        if (lower.includes("hello") || lower.includes("hi ultron") || lower.includes("hey ultron")) {
          return {
            permitted: true,
            intent: classification.intent,
            executed: true,
            spokenResponse: "Hello sir. ULTRON is online. How may I assist you?"
          };
        }
        if (lower.includes("tell me when") || lower.includes("notify me")) {
          return {
            permitted: true,
            intent: classification.intent,
            executed: false,
            spokenResponse: "I understand. No notification or reminder has been scheduled by this telephone command."
          };
        }
        if (this.brainRouter && typeof this.brainRouter.executeInference === "function") {
          let inference;
          try {
            inference = await this.brainRouter.executeInference({
              prompt: String(speechText || "").trim(),
              context: {
                source: "telephony",
                language: lang.language,
                callId: callId || null
              }
            });
          } catch (error) {
            inference = {
              success: false,
              error: String(error?.message || "TELEPHONY_INFERENCE_FAILED").slice(0, 300)
            };
          }

          if (inference?.success === true && typeof inference.content === "string" && inference.content.trim()) {
            return {
              permitted: true,
              intent: classification.intent,
              executed: true,
              spokenResponse: inference.content.trim().slice(0, 3000),
              details: {
                provider: inference.provider || null,
                model: inference.model || null,
                latencyMs: inference.latencyMs ?? null,
                confidence: inference.confidence || null,
                fallbackCount: inference.fallbackCount ?? null
              }
            };
          }

          return {
            permitted: true,
            intent: classification.intent,
            executed: false,
            spokenResponse: "I could not reach a working AI inference provider. Please try again when ULTRON's AI connection is available.",
            details: {
              error: inference?.error || "AI_INFERENCE_UNAVAILABLE",
              chainAttempted: inference?.chainAttempted || []
            }
          };
        }

        return {
          permitted: true,
          intent: classification.intent,
          executed: false,
          spokenResponse: "The telephone AI brain is not connected to ULTRON's inference router. I have not processed this as an AI answer.",
          details: { error: "BRAIN_ROUTER_UNAVAILABLE" }
        };
      }
    }
  }
}

export const telephonyBrain = new TelephonyBrain();
