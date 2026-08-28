package org.rkms.connect;

import android.content.Context;
import android.provider.Settings;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class FCMTokenRegistrar {

    private static final String TAG = "RKMS_FCM";
    private static final String FCM_FUNCTION_URL =
            "https://kzczivaydandiqgnzfeg.supabase.co/functions/v1/rkms-fcm-push";

    private FCMTokenRegistrar() {
    }

    public static void register(Context context, String accessToken) {
        if (context == null || accessToken == null || accessToken.isEmpty()) {
            return;
        }

        FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token ->
                        registerWithToken(context, accessToken, token))
                .addOnFailureListener(e ->
                        Log.w(TAG, "FCM getToken failed", e));
    }

    public static void registerWithToken(
            Context context,
            String accessToken,
            String token
    ) {
        if (context == null
                || accessToken == null
                || accessToken.isEmpty()
                || token == null
                || token.isEmpty()) {
            return;
        }

        post(context, accessToken, "register_token", token);
    }

    public static void unregister(Context context, String accessToken) {
        if (context == null || accessToken == null || accessToken.isEmpty()) {
            return;
        }

        FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token -> {
                    if (token != null && !token.isEmpty()) {
                        post(context, accessToken, "unregister_token", token);
                    }
                })
                .addOnFailureListener(e ->
                        Log.w(TAG, "FCM getToken for unregister failed", e));
    }

    private static void post(
            Context context,
            String accessToken,
            String action,
            String token
    ) {
        new Thread(() -> {
            HttpURLConnection connection = null;

            try {
                URL url = new URL(FCM_FUNCTION_URL);
                connection = (HttpURLConnection) url.openConnection();

                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(15000);
                connection.setDoOutput(true);

                connection.setRequestProperty(
                        "Content-Type",
                        "application/json; charset=UTF-8"
                );
                connection.setRequestProperty(
                        "Accept",
                        "application/json"
                );
                connection.setRequestProperty(
                        "Authorization",
                        "Bearer " + accessToken
                );

                String deviceId = "";

                try {
                    String value = Settings.Secure.getString(
                            context.getContentResolver(),
                            Settings.Secure.ANDROID_ID
                    );
                    if (value != null) {
                        deviceId = value;
                    }
                } catch (Throwable ignored) {
                    // Keep empty device ID if Android does not expose it.
                }

                JSONObject payload = new JSONObject();
                payload.put("action", action);
                payload.put("fcm_token", token);
                payload.put("device_id", deviceId);
                payload.put("platform", "android");
                payload.put("app_version", BuildConfig.VERSION_NAME);

                byte[] bytes = payload.toString()
                        .getBytes(StandardCharsets.UTF_8);

                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                    output.flush();
                }

                int responseCode = connection.getResponseCode();

                InputStream input = responseCode >= 400
                        ? connection.getErrorStream()
                        : connection.getInputStream();

                String response = readResponse(input);

                if (responseCode >= 400) {
                    Log.w(
                            TAG,
                            "Token " + action
                                    + " failed HTTP "
                                    + responseCode
                                    + ": "
                                    + response
                    );
                } else {
                    Log.d(
                            TAG,
                            "Token " + action
                                    + " succeeded: "
                                    + response
                    );
                }

            } catch (Exception e) {
                Log.w(
                        TAG,
                        "Token " + action + " network failure",
                        e
                );
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }).start();
    }

    private static String readResponse(InputStream input) {
        if (input == null) {
            return "";
        }

        StringBuilder result = new StringBuilder();

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(
                        input,
                        StandardCharsets.UTF_8
                )
        )) {
            String line;

            while ((line = reader.readLine()) != null) {
                result.append(line);
            }

        } catch (IOException e) {
            Log.w(TAG, "Unable to read FCM response", e);
        }

        return result.toString();
    }
}
