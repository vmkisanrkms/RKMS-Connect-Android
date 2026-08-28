package org.rkms.connect;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION = 1001;
    private static final int FILE_CHOOSER = 1002;
    private static final int MICROPHONE_PERMISSION = 1003;
    private static final String ASSET_HOME = "file:///android_asset/www/index.html";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        configureWebView(webView);
        webView.addJavascriptInterface(new RKMSBridge(this), "RKMSNative");
        createNotificationChannel();
        requestNotificationPermission();
        loadInitialRoute(getIntent());
    }

    private void loadInitialRoute(Intent intent) {
        String route = intent == null ? null : intent.getStringExtra("rkms_route");
        if (route == null || route.trim().isEmpty()) route = intent == null ? null : intent.getStringExtra("route");
        if ((route == null || route.trim().isEmpty()) && intent != null) {
            String cid = intent.getStringExtra("conversation_id");
            if (cid != null && !cid.trim().isEmpty()) route = "chat/" + cid.trim();
        }
        route = sanitizeRoute(route);
        webView.loadUrl(ASSET_HOME + (route.isEmpty() ? "" : "#" + route));
    }

    private String sanitizeRoute(String route) {
        if (route == null || route.trim().isEmpty()) return "";
        String r = route.trim();
        while (r.startsWith("#")) r = r.substring(1);
        r = r.replace('\\', '/');
        if (r.contains("..") || r.startsWith("http:") || r.startsWith("https:") || r.startsWith("file:")) return "home";
        String base = r.contains("/") ? r.substring(0, r.indexOf('/')) : r;
        if (!NotificationRoutePolicy.isAllowedBase(base)) return "home";
        if (r.matches("chat/[A-Za-z0-9_-]+") || r.matches("district/[A-Za-z0-9_.:-]+") ||
                r.matches("officer/[A-Za-z0-9_.:-]+") || r.matches("my-complaint/[A-Za-z0-9_.:-]+") ||
                r.matches("complaint-detail/[A-Za-z0-9_.:-]+") || r.equals(base)) return r;
        return "home";
    }

    private void configureWebView(WebView view) {
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return handleExternalUrl(request == null ? null : request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return handleExternalUrl(url == null ? null : Uri.parse(url));
            }

            private boolean handleExternalUrl(Uri uri) {
                if (uri == null) return true;
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if ("file".equals(scheme)) return false;
                if ("http".equals(scheme) || "https".equals(scheme) || "tel".equals(scheme) || "mailto".equals(scheme) || "geo".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                    return true;
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                super.onPageFinished(v, url);
                String nativeAccess = SessionStore.access(getApplicationContext());
                String nativeRefresh = SessionStore.refresh(getApplicationContext());
                if (nativeAccess != null && !nativeAccess.isEmpty()) {
                    String jsAccess = org.json.JSONObject.quote(nativeAccess);
                    String jsRefresh = org.json.JSONObject.quote(nativeRefresh == null ? "" : nativeRefresh);
                    v.evaluateJavascript(
                        "(function(a,r){try{var ca=localStorage.getItem('rkms_access_token')||'';" +
                        "if(!ca){localStorage.setItem('rkms_access_token',a);if(r)localStorage.setItem('rkms_refresh_token',r);" +
                        "localStorage.removeItem('rkms_access_expires_at');location.reload();return;}" +
                        "if(window.RKMSNative)window.RKMSNative.saveSession(a,r,'');}catch(e){console.warn('RKMS session restore failed',e)}})(" +
                        jsAccess + "," + jsRefresh + ");", null);
                } else {
                    v.evaluateJavascript(
                        "(function(){try{var a=localStorage.getItem('rkms_access_token')||'';var r=localStorage.getItem('rkms_refresh_token')||'';" +
                        "if(a&&window.RKMSNative){window.RKMSNative.saveSession(a,r,'');}}catch(e){}})();", null);
                }
            }
        });

        view.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.trim().isEmpty()) return;
            try {
                Intent downloadIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(downloadIntent);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "इस फ़ाइल को खोलने के लिए कोई app उपलब्ध नहीं है।", Toast.LENGTH_SHORT).show();
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (request == null) return;
                    boolean audioRequested = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) { audioRequested = true; break; }
                    }
                    if (!audioRequested) { request.deny(); return; }
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingPermissionRequest = request;
                        ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_PERMISSION);
                    }
                });
            }
        });
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
        }
    }

    private void createNotificationChannel() {
        NotificationHelper.ensureChannel(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String route = intent == null ? null : intent.getStringExtra("rkms_route");
        if (route == null || route.trim().isEmpty()) route = intent == null ? null : intent.getStringExtra("route");
        if ((route == null || route.trim().isEmpty()) && intent != null) {
            String cid = intent.getStringExtra("conversation_id");
            if (cid != null && !cid.trim().isEmpty()) route = "chat/" + cid.trim();
        }
        route = sanitizeRoute(route);
        if (!route.isEmpty() && webView != null) webView.loadUrl(ASSET_HOME + "#" + route);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MICROPHONE_PERMISSION && pendingPermissionRequest != null) {
            PermissionRequest request = pendingPermissionRequest;
            pendingPermissionRequest = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER) {
            if (fileCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) results = new Uri[]{uri};
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        try {
            String access = SessionStore.access(getApplicationContext());
            if (access != null && !access.isEmpty()) FCMTokenRegistrar.register(getApplicationContext(), access);
        } catch (Throwable e) {
            android.util.Log.w("RKMS_FCM", "onResume registration failed", e);
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingPermissionRequest != null) { try { pendingPermissionRequest.deny(); } catch (Throwable ignored) {} pendingPermissionRequest = null; }
        if (webView != null) { webView.stopLoading(); webView.destroy(); webView = null; }
        super.onDestroy();
    }

    static final class NotificationRoutePolicy {
        private static final java.util.Set<String> ALLOWED = new java.util.HashSet<>(java.util.Arrays.asList(
                "home", "member-list", "active-officers", "organization", "leadership", "vmsingh",
                "directory", "district", "officer", "membership", "login", "login-slogans",
                "content-management", "officer-login", "chat", "password-reset-requests",
                "member-dashboard", "member-update", "digital-id", "appointment-letter",
                "membership-certificate", "complaint", "my-complaints", "my-complaint", "book",
                "news", "events", "gallery", "documents", "reports", "campaigns",
                "notifications", "admin", "content", "security-audit", "officer-dashboard",
                "officer-complaints", "complaint-detail", "pending", "appointment"
        ));
        static boolean isAllowedBase(String route) { return ALLOWED.contains(route); }
    }

    public static class RKMSBridge {
        private final Context context;
        RKMSBridge(Context context) { this.context = context.getApplicationContext(); }

        @JavascriptInterface
        public void saveSession(String accessToken, String refreshToken, String role) {
            SessionStore.save(context, accessToken, refreshToken, role);
            try { FCMTokenRegistrar.register(context, accessToken); } catch (Throwable ignored) {}
        }

        @JavascriptInterface
        public void clearSession() {
            String access = SessionStore.access(context);
            try { FCMTokenRegistrar.unregister(context, access); } catch (Throwable ignored) {}
            SessionStore.clear(context);
        }

        @JavascriptInterface
        public String getAccessToken() { return SessionStore.access(context); }

        @JavascriptInterface
        public String getRefreshToken() { return SessionStore.refresh(context); }

        @JavascriptInterface
        public String getRole() { return SessionStore.role(context); }

        @JavascriptInterface
        public void showNotification(String title, String body) { NotificationHelper.show(context, title, body, "home", null); }

        @JavascriptInterface
        public void toast(String message) { Toast.makeText(context, message, Toast.LENGTH_SHORT).show(); }
    }
}
