package org.rkms.connect;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class RKMSFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        try {
            String accessToken = SessionStore.access(getApplicationContext());
            if (accessToken != null && !accessToken.isEmpty()) {
                FCMTokenRegistrar.registerWithToken(getApplicationContext(), accessToken, token);
            }
        } catch (Throwable e) {
            android.util.Log.w("RKMS_FCM", "onNewToken failed", e);
        }
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        String title = "RKMS Connect";
        String body = "";
        String route = "home";
        Map<String, String> data = message.getData();
        if (data.get("title") != null) title = data.get("title");
        if (data.get("body") != null) body = data.get("body");
        if (body.isEmpty() && data.get("message") != null) body = data.get("message");
        if (data.get("route") != null && !data.get("route").isEmpty()) route = data.get("route");
        else if (data.get("conversation_id") != null && !data.get("conversation_id").isEmpty()) route = "chat/" + data.get("conversation_id");
        String eventKey = data.get("event_id");
        if (eventKey == null || eventKey.isEmpty()) eventKey = data.get("queue_id");
        if (eventKey == null || eventKey.isEmpty()) eventKey = data.get("message_id");
        if (eventKey == null || eventKey.isEmpty()) eventKey = message.getMessageId();
        NotificationHelper.show(getApplicationContext(), title, body, route, eventKey);
    }
}
