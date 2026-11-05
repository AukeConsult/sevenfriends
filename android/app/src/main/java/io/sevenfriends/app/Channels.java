package io.sevenfriends.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

/**
 * The notification channels. On Android 8+ the sound of a notification belongs to its channel, so there is one
 * channel per jingle (the files are in res/raw). The backend (functions/src/push.ts, CHANNEL_BY_JINGLE) names the
 * channel in every push: the ids here must match it.
 *
 * A channel's sound cannot be changed on a phone once the channel exists: to change a sound, use a NEW channel id
 * here and in push.ts.
 */
final class Channels {
    static final String DEFAULT = "default";

    private Channels() {}

    static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        nm.createNotificationChannel(new NotificationChannel(DEFAULT, "Seven Friends", NotificationManager.IMPORTANCE_HIGH));
        addSound(context, nm, "sound_drill", "Drill", "drill");
        addSound(context, nm, "sound_hyper", "Hyper", "hyper");
        addSound(context, nm, "sound_acidbreaks", "Acid Breaks", "acidbreaks");
    }

    private static void addSound(Context context, NotificationManager nm, String id, String name, String rawName) {
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        // by NAME (res/raw/<rawName>.mp3), never by the numeric resource id: the numbers change with every build, while a
        // channel keeps the address it was created with, so an id-based address stops working after the next build
        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.getPackageName() + "/raw/" + rawName);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(sound, attrs);
        nm.createNotificationChannel(channel);
    }
}
