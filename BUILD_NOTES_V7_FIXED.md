# RKMS Connect V7 Fixed Build Source

This source is based on the V7 release-ready Android project.

Build fixes applied:
- Enabled Android BuildConfig generation in app/build.gradle.
- Replaced manual JSON string construction in FCMTokenRegistrar with org.json.JSONObject.
- FCM app_version now uses BuildConfig.VERSION_NAME.
- Updated GitHub Actions Java setup to actions/setup-java@v5.
- Workflow builds the actual rkms_android Gradle project and uploads a debug APK.

Important:
- A successful GitHub Actions build does not by itself prove real-phone FCM delivery.
- Background, closed-app, notification tap routing, and duplicate-prevention must still be tested on a real Android device.
- Release signing/AAB requires the repository's configured signing secrets.
