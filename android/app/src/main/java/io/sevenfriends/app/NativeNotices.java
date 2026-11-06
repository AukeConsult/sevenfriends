package io.sevenfriends.app;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * The bridge between the web app inside and the Android screen for notifications (NativeCheck.java). It owns nothing: the web app
 * (android-channels.service.ts) holds the choices, the sign-in and the saving, and Android holds the channels (Channels.java).
 *
 * The page reaches this class as window.SevenFriendsAndroid (the @JavascriptInterface methods: sync, openCheck and the answers appState,
 * deviceSet, pushed, tested). This class reaches the page as window.sfAndroid (read, device, hideText, test, fromAndroid).
 * The answers are handed to the screen that is open through the on... fields.
 */
final class NativeNotices {
    static final String NAME = "SevenFriendsAndroid";

    private final Activity activity;
    private final WebView web;

    /** the answers of the page, shown by the screen that is open (NativeCheck sets them) */
    Consumer<String> onPushed;
    Consumer<String> onAppState;
    Consumer<String> onTested;
    BiConsumer<Boolean, String> onDeviceSet;

    private boolean pushing;
    private boolean appAnswered;
    /** what pushToApp() sent last; remembered as 'given to the app' once the page says it is stored */
    private String pendingState;

    NativeNotices(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    // ---- the page calls these

    /** The app tells which sound each kind has (at start and whenever it changes): Android's channels follow. */
    @JavascriptInterface
    public void sync(String soundsJson) {
        try {
            Channels.sync(activity, new JSONObject(soundsJson));
        } catch (JSONException | NullPointerException e) {
            // not understood: the channels stay as they are
        }
    }

    /** The Settings page of the app has a button for the notification screen. */
    @JavascriptInterface
    public void openCheck() {
        activity.runOnUiThread(() -> NativeCheck.show(activity, this));
    }

    @JavascriptInterface
    public void appState(String json) {
        activity.runOnUiThread(() -> {
            appAnswered = true;
            if (onAppState != null) onAppState.accept(json);
        });
    }

    /** The page's answer to setDevice(): whether this phone is registered now, and why not when it could not be turned on. */
    @JavascriptInterface
    public void deviceSet(boolean on, String problem) {
        activity.runOnUiThread(() -> {
            if (onDeviceSet != null) onDeviceSet.accept(on, problem);
        });
    }

    @JavascriptInterface
    public void pushed(boolean ok, String text) {
        activity.runOnUiThread(() -> {
            pushing = false;
            if (ok && pendingState != null) {
                activity.getSharedPreferences("channels", Context.MODE_PRIVATE).edit().putString("lastPushed", pendingState).apply();
            }
            if (onPushed != null) onPushed.accept(activity.getString(ok ? R.string.push_ok : R.string.push_failed, text));
        });
    }

    @JavascriptInterface
    public void tested(String text) {
        activity.runOnUiThread(() -> {
            if (onTested != null) onTested.accept(text);
        });
    }

    // ---- this class calls the page

    /** Asks the page what the app has (this device's switch, hide the text, the app's volume). The answer comes to appState(). */
    void readApp() {
        appAnswered = false;
        run("window.sfAndroid ? window.sfAndroid.read() : 0");
        web.postDelayed(() -> {
            if (onAppState != null && !appAnswered) onAppState.accept("{\"error\":" + JSONObject.quote(activity.getString(R.string.err_no_answer)) + "}");
        }, 10000);
    }

    /** "Notify this device": the page registers or forgets this phone and answers with deviceSet(). */
    void setDevice(boolean on) {
        run("window.sfAndroid ? window.sfAndroid.device(" + on + ") : 0");
    }

    /** "Hide the text on the lock screen": the page stores it on the account and answers with appState(). */
    void setHideText(boolean on) {
        run("window.sfAndroid ? window.sfAndroid.hideText(" + on + ") : 0");
    }

    /** A test notification through the server to all devices; the page answers with tested(text). */
    void test() {
        run("window.sfAndroid ? window.sfAndroid.test() : 0");
        web.postDelayed(() -> {
            if (onTested != null) onTested.accept("");
        }, 12000);
    }

    /**
     * What Android has for this phone, as the page needs it: for each kind true = on, and the notification volume. The page stores it on the account
     * (android-channels.service.ts, sfAndroid.fromAndroid) and answers with pushed(). Nothing is sent when it is the same as the last
     * time the page stored it.
     */
    void pushToApp() {
        NotificationManager nm = activity.getSystemService(NotificationManager.class);
        JSONObject state = new JSONObject();
        boolean allowed = nm == null || nm.areNotificationsEnabled();
        try {
            for (int i = 0; i < Channels.KINDS.length; i++) {
                NotificationChannel channel = channelOf(i);
                state.put(Channels.KINDS[i], allowed && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE));
            }
        } catch (JSONException e) {
            return;
        }
        try {
            state.put("volume", NativeCheck.notificationVolume(activity)); // the phone's notification volume, 0-100: the app's volume follows it
        } catch (JSONException e) {
            return;
        }
        String sent = state.toString();
        if (sent.equals(activity.getSharedPreferences("channels", Context.MODE_PRIVATE).getString("lastPushed", null))) return;
        pendingState = sent;
        pushing = true;
        run("window.sfAndroid ? window.sfAndroid.fromAndroid(" + JSONObject.quote(state.toString()) + ") : 0");
        web.postDelayed(() -> pushing = false, 10000);
    }

    /** Android's page for this kind of notification (only the person can switch a channel on again: an app cannot). */
    void openChannelPage(int kind) {
        NotificationManager nm = activity.getSystemService(NotificationManager.class);
        boolean appOff = nm != null && !nm.areNotificationsEnabled();
        NotificationChannel channel = channelOf(kind);
        Intent intent = appOff || channel == null
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            : new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, channel.getId());
        activity.startActivity(intent.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName()));
    }

    /** Android's channel of this kind (there is one), or null before Android 8. */
    private NotificationChannel channelOf(int kind) {
        NotificationManager nm = activity.getSystemService(NotificationManager.class);
        return nm == null ? null : Channels.currentChannel(nm, Channels.KINDS[kind]);
    }

    private void run(String js) {
        web.evaluateJavascript(js, null);
    }
}
