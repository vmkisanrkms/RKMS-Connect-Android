package org.rkms.connect;

import android.Manifest;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class NotificationHelper {
    /** New channel ID intentionally avoids old silent-channel user settings. */
    public static final String CHANNEL_ID = "rkms_notifications_v2";
    private static final long[] VIBRATION = new long[]{0, 300, 180, 500};
    private static final Set<String> ALLOWED_ROUTES = new HashSet<>(Arrays.asList(
            "home", "member-list", "active-officers", "organization", "leadership", "vmsingh",
            "directory", "district", "officer", "membership", "login", "login-slogans",
            "content-management", "officer-login", "chat", "password-reset-requests",
            "member-dashboard", "member-update", "digital-id", "appointment-letter",
            "membership-certificate", "complaint", "my-complaints", "my-complaint", "book",
            "news", "events", "gallery", "documents", "reports", "campaigns",
            "notifications", "admin", "content", "security-audit", "officer-dashboard",
            "officer-complaints", "complaint-detail", "pending", "appointment"
    ));

    private NotificationHelper() {}

    public static void show(Context context, String title, String body, String route) {
        show(context, title, body, route, null);
    }

    public static void show(Context context, String title, String body, String route, String eventKey) {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        String safeTitle = title == null || title.trim().isEmpty() ? "RKMS Connect" : title.trim();
        String safeBody = body == null || body.trim().isEmpty() ? "नई RKMS सूचना" : body.trim();
        String safeRoute = normalizeRoute(route);
        String stableKey = eventKey == null || eventKey.trim().isEmpty()
                ? safeTitle + "|" + safeBody + "|" + safeRoute
                : eventKey.trim();
        int id = stableNotificationId(stableKey);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction("org.rkms.connect.NOTIFICATION_OPEN");
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("rkms_route", safeRoute);
        intent.putExtra("route", safeRoute);
        if (safeRoute.startsWith("chat/")) {
            intent.putExtra("conversation_id", safeRoute.substring(5));
        }

        PendingIntent pi = PendingIntent.getActivity(
                context,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT |
                        (android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(safeTitle)
                .setContentText(safeBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setContentIntent(pi)
                .setVibrate(VIBRATION)
                .setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI);

        NotificationManagerCompat.from(context).notify(id, b.build());
    }

    public static void show(Context context, String title, String body) {
        show(context, title, body, "home", null);
    }

    private static String normalizeRoute(String route) {
        if (route == null || route.trim().isEmpty()) return "home";
        String r = route.trim();
        while (r.startsWith("#")) r = r.substring(1);
        r = r.replace('\\', '/');
        if (r.contains("..") || r.startsWith("http:") || r.startsWith("https:") || r.startsWith("file:")) return "home";
        String base = r.contains("/") ? r.substring(0, r.indexOf('/')) : r;
        if (!ALLOWED_ROUTES.contains(base)) return "home";
        if (r.matches("chat/[A-Za-z0-9_-]+") || r.matches("district/[A-Za-z0-9_.:-]+") ||
                r.matches("officer/[A-Za-z0-9_.:-]+") || r.matches("my-complaint/[A-Za-z0-9_.:-]+") ||
                r.matches("complaint-detail/[A-Za-z0-9_.:-]+") || r.equals(base)) return r;
        return "home";
    }

    private static int stableNotificationId(String key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            int value = ((digest[0] & 0xff) << 24) | ((digest[1] & 0xff) << 16)
                    | ((digest[2] & 0xff) << 8) | (digest[3] & 0xff);
            return value == 0 ? 1 : value & 0x7fffffff;
        } catch (Exception e) {
            return Math.abs(key.hashCode()) | 1;
        }
    }

    public static void ensureChannel(Context context) {
        if (android.os.Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        Uri sound = android.provider.Settings.System.DEFAULT_NOTIFICATION_URI;
        NotificationChannelCompat.create(nm, sound);
    }

    /** Kept in this class so channel creation has one source of truth. */
    private static final class NotificationChannelCompat {
        static void create(NotificationManager nm, Uri sound) {
            if (android.os.Build.VERSION.SDK_INT < 26) return;
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    CHANNEL_ID,
                    "RKMS Connect Notifications",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("RKMS Connect messages and alerts");
            channel.setShowBadge(true);
            channel.enableVibration(true);
            channel.setVibrationPattern(VIBRATION);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            channel.setSound(sound, attrs);
            nm.createNotificationChannel(channel);
        }
    }
}
