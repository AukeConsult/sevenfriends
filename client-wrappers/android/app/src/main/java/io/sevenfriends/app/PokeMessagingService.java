package io.sevenfriends.app;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives the pushes. A POKE (`poke=1` in the data, see functions/src/push.ts) is sent with no notification part, so this code runs even when the app is
 * closed, and starts the alarm (PokeService). Everything else goes to the Capacitor push plugin as before (this class extends its service, which the manifest
 * removes in favour of this one).
 */
public class PokeMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"1".equals(data.get("poke"))) {
            super.onMessageReceived(message);
            return;
        }
        // there is no switch for a poke: it always rings
        ContextCompat.startForegroundService(this, PokeService.start(this, data.get("title"), data.get("body"), data.get("url")));
    }
}
