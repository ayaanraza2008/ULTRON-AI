# ULTRON Android Wake Companion

This Android companion listens for “Ultron” only after the user explicitly starts it. It requests microphone and notification permission, uses Android's on-device speech recognizer only, and shows a persistent notification with a Stop control. A detected wake word creates a notification; the user taps it to open the hosted ULTRON assistant.

## Build

The GitHub Actions workflow compiles a debug APK and publishes it as a downloadable workflow artifact. A debug APK is for testing/sideloading, not a signed Play Store release.

Requirements: Java 17, Android SDK 35, and Gradle 8.9. From this directory run `gradle --no-daemon assembleDebug`. Output: `app/build/outputs/apk/debug/app-debug.apk`.

## Limitations

- Android 12 or newer is required.
- An on-device English speech model must already be installed; the app does not download models or fall back to cloud recognition.
- Keep the ongoing listening notification visible and use its Stop action to disable the microphone.
- The foreground service requests a best-effort restart if Android reclaims its process. Android controls background microphone access and battery optimization; listening is not guaranteed after force-stop, reboot, deep sleep, or OEM restrictions. After reboot, open the companion and enable listening again.
- Wake notifications do not bypass the lock screen or device authentication.
- This is a wake-word companion, not the full mobile ULTRON app or remote phone-control system.
