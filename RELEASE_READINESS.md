# RKMS Connect Release Readiness

## Fixed in this source
- FCM registration reports `BuildConfig.VERSION_NAME` instead of a hard-coded version.
- Notifications use stable event/message/queue keys when available, avoiding timestamp-only IDs.
- Notification and deep-link routes are restricted to known RKMS screens/ID patterns.
- Notification tap uses a stable PendingIntent and sanitized RKMS route.
- Android WebView handles microphone permission for voice recording.
- External HTTP(S), tel, mailto and geo links open through Android intents.
- Download clicks are handed to Android for appropriate file handling.
- Release signing is supported through environment variables; signing material is not committed.
- GitHub Actions builds a debug smoke-test APK and a signed release AAB when required secrets are configured.

## Still requires real-device verification
- Android 13+ notification permission prompt and channel behavior.
- FCM delivery with app open, background and terminated states.
- Notification tap to every supported RKMS destination.
- Duplicate delivery using identical `event_id`, `queue_id` or `message_id`.
- Voice recording and microphone denial/retry flows.
- File upload/download and external links.
- Login/session restore after process death and reboot.
- Weak-network performance and offline/retry behavior.

## Required GitHub Actions secrets
- `RKMS_KEYSTORE_BASE64`
- `RKMS_KEYSTORE_PASSWORD`
- `RKMS_KEY_ALIAS`
- `RKMS_KEY_PASSWORD`

Never commit the keystore, passwords, or Firebase server credentials to the repository.
