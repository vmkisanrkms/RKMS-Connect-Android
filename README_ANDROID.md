# RKMS Connect Android

This project packages the current RKMS Connect website as an Android WebView app.

## Included
- Current RKMS website bundled under `app/src/main/assets/www/`
- Supabase-backed Member / PDA Officer / Super Admin login and chat
- Persistent login: app-side 30-minute auto logout removed; session refresh uses the Supabase refresh token and explicit Logout
- Firebase Cloud Messaging (FCM) Android integration
- FCM token registration/unregistration against the RKMS Supabase push function
- High-priority FCM handling so Android can build the notification itself
- Notification tap opens the relevant RKMS Chat conversation when a conversation id is supplied
- Android notification permission/channel

## Firebase
The Android application id is `org.rkms.connect` and `app/google-services.json` must belong to the same Firebase project used by the Supabase FCM service-account secret.

## Build
Use Java 17 with Gradle/Android Studio or the repository GitHub Actions workflow. The project targets Android API 35.

## Notification flow
Chat message -> `rkms_push_queue` -> `rkms-fcm-dispatch` (with the authenticated client fallback through `rkms-fcm-push`) -> Firebase FCM -> Android notification -> Chat route.

The APK must still be tested on two real Android devices for end-to-end delivery. A successful server response alone is not treated as proof of device receipt.


## GitHub Actions
The included `.github/workflows/build-apk.yml` builds `app/build/outputs/apk/debug/*.apk` using Java 17 and Android API 35. The workflow assumes the contents of this `rkms_android` directory are the repository root.

## Persistent session limitation
The authenticated session survives normal app close/reopen and device restart until the user explicitly logs out, using Supabase refresh-token persistence. Android's OS-level **Clear app data/All data** intentionally erases application storage; no password is stored to bypass that security boundary.
