package io.sevenfriends.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

/**
 * The alarm of a poke: a foreground service that plays the phone's alarm sound in a loop on the ALARM volume (so the ringer's silent mode does not stop it,
 * and the alarm volume is raised for the time it rings), vibrates, and shows a full-screen notification (PokeActivity) with who poked. It stops when the
 * person presses Stop or Open, or after MAX_MS.
 */
public class PokeService extends Service {

    static final String ACTION_STOP = "io.sevenfriends.app.POKE_STOP";
    /** Sent when the alarm is over, so that PokeActivity closes. */
    static final String ACTION_DONE = "io.sevenfriends.app.POKE_DONE";
    static final String EXTRA_NAME = "name";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_URL = "url";

    private static final String CHANNEL = "poke_alarm";
    private static final int NOTIFICATION_ID = 7007;
    private static final long MAX_MS = 2 * 60 * 1000;

    private MediaPlayer player;
    private Vibrator vibrator;
    private AudioManager audio;
    private int oldVolume = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable giveUp = this::stopSelf;

    static Intent start(Context context, String name, String text, String url) {
        return new Intent(context, PokeService.class).putExtra(EXTRA_NAME, name).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_URL, url);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String name = intent == null ? null : intent.getStringExtra(EXTRA_NAME);
        String text = intent == null ? null : intent.getStringExtra(EXTRA_TEXT);
        String url = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        if (name == null || name.isEmpty()) name = getString(R.string.app_name);

        makeChannel();
        Intent screen = new Intent(this, PokeActivity.class).putExtra(EXTRA_NAME, name).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_URL, url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent screenIntent = PendingIntent.getActivity(this, 0, screen, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stopIntent = PendingIntent.getService(this, 1, new Intent(this, PokeService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(getString(R.string.poke_from, name)) // who is poking
                .setContentText(text == null || text.isEmpty() ? getString(R.string.poke_wants_you) : text)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setContentIntent(screenIntent)
                .setFullScreenIntent(screenIntent, true)
                .addAction(0, getString(R.string.poke_stop), stopIntent)
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION_ID, notification);

        if (player == null) ring();
        handler.removeCallbacks(giveUp);
        handler.postDelayed(giveUp, MAX_MS);
        return START_NOT_STICKY;
    }

    private void makeChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.poke_channel), NotificationManager.IMPORTANCE_HIGH);
        channel.setSound(null, null); // the service plays the sound itself, on the alarm volume
        channel.setBypassDnd(true); // only works when the person has allowed it in Android's Do Not Disturb access
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    private void ring() {
        audio = getSystemService(AudioManager.class);
        if (audio != null) {
            oldVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
        }
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            if (player != null) player.release();
            player = null; // no sound: the vibration and the screen still tell
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null && vibrator.hasVibrator()) {
            long[] pattern = {0, 800, 600};
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            else vibrator.vibrate(pattern, 0);
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(giveUp);
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        if (vibrator != null) vibrator.cancel();
        if (audio != null && oldVolume >= 0) audio.setStreamVolume(AudioManager.STREAM_ALARM, oldVolume, 0);
        stopForeground(true);
        sendBroadcast(new Intent(ACTION_DONE).setPackage(getPackageName())); // the alarm screen closes
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
