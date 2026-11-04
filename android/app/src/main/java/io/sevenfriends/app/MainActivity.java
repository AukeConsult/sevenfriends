package io.sevenfriends.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Creates the notification channels. On Android 8+ the sound of a notification belongs to its channel,
 * so there is one channel per jingle. The backend picks the sound by sending the channel id in the push:
 *   android.notification.channelId = "sound_drill" | "sound_hyper" | "sound_acidbreaks" | "default"
 * The sound files are in res/raw (lowercase names). Note: a channel's sound cannot be changed after it was
 * created on a phone: to change a sound, use a new channel id.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createChannels();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel def = new NotificationChannel("default", "Seven Friends", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(def);

        addSoundChannel(nm, "sound_drill", "Drill", R.raw.drill);
        addSoundChannel(nm, "sound_hyper", "Hyper", R.raw.hyper);
        addSoundChannel(nm, "sound_acidbreaks", "Acid Breaks", R.raw.acidbreaks);
    }

    private void addSoundChannel(NotificationManager nm, String id, String name, int rawRes) {
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + rawRes);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(sound, attrs);
        nm.createNotificationChannel(channel);
    }
}
