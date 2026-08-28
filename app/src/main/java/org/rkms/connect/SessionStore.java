package org.rkms.connect;

import android.content.Context;
import android.content.SharedPreferences;

public final class SessionStore {
    private static final String PREF = "rkms_native_session";
    private SessionStore() {}

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static void save(Context c, String access, String refresh, String role) {
        p(c).edit()
                .putString("access", access == null ? "" : access)
                .putString("refresh", refresh == null ? "" : refresh)
                .putString("role", role == null ? "" : role)
                .apply();
    }

    public static void clear(Context c) {
        p(c).edit().clear().apply();
    }

    public static String access(Context c) { return p(c).getString("access", ""); }
    public static String refresh(Context c) { return p(c).getString("refresh", ""); }
    public static String role(Context c) { return p(c).getString("role", ""); }
}
