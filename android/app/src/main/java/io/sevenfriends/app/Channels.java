package io.sevenfriends.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

/**
 * The notification channels, so Android's own settings show exactly what the app's settings show: ONE channel per kind of
 * notification (new messages, friend requests, answers, removed friendships), with the sound the person chose for it in the app.
 *
 * The channel is called "<kind>_<sound>" (functions/src/push.ts, channelFor, names it in every push: the ids must match). Android
 * never changes the sound of a channel that exists, so when the sound of a kind changes, the channel of the old sound is replaced
 * by the one of the new sound (sync()). If the kind was switched off in Android's settings, the new channel is switched off too.
 */
final class Channels {
    /** the kinds of push, with the name Android's settings show (push.ts: PushMessage.kind) */
    static final String[] KINDS = {"message", "request", "answer", "removed"};
    /** the name of each kind in the language of the phone (the strings.xml files in res) */
    private static final int[] KIND_NAME_IDS = {R.string.kind_message, R.string.kind_request, R.string.kind_answer, R.string.kind_removed};
    /** "default" is the phone's own sound; "silent" is "No sound" */
    static final String DEFAULT = "default";
    static final String SILENT = "silent";
    static final String[] JINGLES = {"drill", "hyper", "acidbreaks"};
    private static final String[] JINGLE_NAMES = {"Drill", "Hyper", "Acid Breaks"};

    private Channels() {}

    static String kindName(Context context, int kind) {
        return context.getString(KIND_NAME_IDS[kind]);
    }

    /** The channel a push of this kind with this sound key uses. */
    static String id(String kind, String sound) {
        return kind + "_" + sound;
    }

    /** The sound key of a sound the person chose in the app: "none", "file:<jingle file>" or a built-in sound. */
    static String soundKey(String choice) {
        if ("none".equals(choice)) return SILENT;
        if (choice != null && choice.startsWith("file:")) {
            String file = choice.toLowerCase();
            for (String jingle : JINGLES) {
                if (file.contains(jingle)) return jingle;
            }
        }
        return DEFAULT;
    }

    /** The name of the sound a channel plays, as the person knows it; null = the phone's own sound is not ours to name. */
    static String soundName(Context context, NotificationChannel channel) {
        Uri sound = channel.getSound();
        if (sound == null) return context.getString(R.string.sound_none);
        String path = sound.getPath();
        for (int i = 0; i < JINGLES.length; i++) {
            if (path != null && path.endsWith("/raw/" + JINGLES[i])) return JINGLE_NAMES[i];
        }
        return context.getString(R.string.sound_phone);
    }

    /** At start: the old channels are gone and every kind has a channel (the phone's sound until the app tells which sound is chosen). */
    static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        // the channels and groups of earlier versions would only be clutter in Android's settings. "default" stays: it is the channel
        // named in the manifest for a push that names none (a push for a channel the phone does not have yet).
        nm.deleteNotificationChannel(SILENT);
        for (String jingle : JINGLES) nm.deleteNotificationChannel("sound_" + jingle);
        for (String kind : KINDS) nm.deleteNotificationChannelGroup("group_" + kind);
        nm.createNotificationChannel(new NotificationChannel(DEFAULT, context.getString(R.string.app_name), NotificationManager.IMPORTANCE_HIGH));

        for (int i = 0; i < KINDS.length; i++) {
            NotificationChannel existing = currentChannel(nm, KINDS[i]);
            if (existing == null) {
                make(context, nm, i, DEFAULT, false);
            } else if (!kindName(context, i).contentEquals(existing.getName())) {
                // the phone's language changed: Android keeps everything of a channel but lets its name be updated
                existing.setName(kindName(context, i));
                nm.createNotificationChannel(existing);
            }
        }
    }

    /**
     * The sound the person chose for each kind (the app's sound settings as JSON: {"message": "file:...", "request": ..., "answer": ...}):
     * each kind gets the channel of its sound.
     */
    static void sync(Context context, JSONObject sounds) {
        // what the page told, and when: NativeCheck shows it, so a bridge call that never arrives can be seen
        context.getSharedPreferences("channels", Context.MODE_PRIVATE).edit()
            .putString("lastSync", sounds.toString()).putLong("lastSyncTime", System.currentTimeMillis()).apply();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        for (int i = 0; i < KINDS.length; i++) {
            String kind = KINDS[i];
            String key = "removed".equals(kind) ? DEFAULT : soundKey(sounds.optString(kind, null));
            if (nm.getNotificationChannel(id(kind, key)) != null) continue; // already the right one
            NotificationChannel old = currentChannel(nm, kind);
            boolean off = old != null && old.getImportance() == NotificationManager.IMPORTANCE_NONE;
            if (old != null) nm.deleteNotificationChannel(old.getId());
            make(context, nm, i, key, off);
        }
    }

    static String lastSync(Context context) {
        return context.getSharedPreferences("channels", Context.MODE_PRIVATE).getString("lastSync", "");
    }

    static long lastSyncTime(Context context) {
        return context.getSharedPreferences("channels", Context.MODE_PRIVATE).getLong("lastSyncTime", 0);
    }

    /** The channel this kind has now (there is one), or null. */
    static NotificationChannel currentChannel(NotificationManager nm, String kind) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null;
        for (NotificationChannel channel : nm.getNotificationChannels()) {
            if (channel.getId().startsWith(kind + "_")) return channel;
        }
        return null;
    }

    private static void make(Context context, NotificationManager nm, int kind, String sound, boolean off) {
        int importance = off ? NotificationManager.IMPORTANCE_NONE
            : SILENT.equals(sound) ? NotificationManager.IMPORTANCE_DEFAULT : NotificationManager.IMPORTANCE_HIGH;
        NotificationChannel channel = new NotificationChannel(id(KINDS[kind], sound), kindName(context, kind), importance);
        if (SILENT.equals(sound)) {
            channel.setSound(null, null); // "No sound": the notification shows, nothing plays
        } else if (!DEFAULT.equals(sound)) {
            // by NAME (res/raw/<rawName>.mp3), never by the numeric resource id: the numbers change with every build, while a
            // channel keeps the address it was created with, so an id-based address stops working after the next build
            Uri uri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.getPackageName() + "/raw/" + sound);
            channel.setSound(uri, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
        nm.createNotificationChannel(channel);
    }
}
