package io.sevenfriends.app;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.os.Build;
import android.provider.Settings;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.widget.SwitchCompat;

import androidx.appcompat.app.AlertDialog;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

/**
 * A form with what Android itself has for this app's notifications, read by the Java code and nothing else: no web page, no sign-in,
 * no bridge involved. It is for checking: is the notification permission on, how loud is the notification volume, which channel does
 * each kind have, is it on, which sound does it play, and what the web page last told the app (Channels.sync) — "never" means the
 * page's bridge call has not arrived. "Send this to the app" hands the same values to the page (NativeNotices.pushToApp). Opened from the
 * bar at the top of the app (MainActivity).
 */
final class NativeCheck {
    private static final int GREEN = 0xFF1B7F3B;
    private static final int RED = 0xFFB3261E;
    private static final int GRAY = 0xFF6B6B6B;

    private NativeCheck() {}

    /** The notification volume of the phone as a percentage (0-100): what decides how loud a push is. */
    static int notificationVolume(Context context) {
        AudioManager audio = context.getSystemService(AudioManager.class);
        if (audio == null) return 0;
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION);
        return max <= 0 ? 0 : Math.round(100f * audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION) / max);
    }

    static void show(Activity activity, NativeNotices notices) {
        float density = activity.getResources().getDisplayMetrics().density;
        int pad = (int) (8 * density);

        LinearLayout form = new LinearLayout(activity);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(pad, pad / 2, pad, pad);

        NotificationManager nm = activity.getSystemService(NotificationManager.class);
        boolean allowed = nm != null && nm.areNotificationsEnabled();

        // at the top: Android's own page, where a kind is switched on or off and its sound is chosen
        Button setInAndroid = new Button(activity);
        setInAndroid.setText(R.string.check_set_in_android);
        setInAndroid.setAllCaps(false);
        setInAndroid.setOnClickListener(v ->
            activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName())));
        form.addView(setInAndroid, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (44 * density)));
        form.addView(note(activity, activity.getString(R.string.check_tap_hint)));

        // the kinds, one line each: the app and Android always agree, so there is one value
        LinearLayout kindsCard = card(activity, activity.getString(R.string.check_notifications));
        for (int i = 0; i < Channels.KINDS.length; i++) {
            NotificationChannel channel = nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? Channels.currentChannel(nm, Channels.circle(activity), Channels.KINDS[i]) : null;
            boolean on = allowed && Channels.isOn(channel);
            String sound = channel == null ? "" : " · " + Channels.soundName(activity, channel);
            final int kind = i;
            TextView line = row(activity, kindsCard, Channels.kindName(activity, i), activity.getString(on ? R.string.state_on : R.string.state_off_loud) + sound, on ? GREEN : RED);
            ((View) line.getParent()).setOnClickListener(v -> notices.openChannelPage(kind));
        }
        form.addView(kindsCard);

        // this phone
        LinearLayout phone = card(activity, activity.getString(R.string.check_this_phone, Build.VERSION.RELEASE));
        row(activity, phone, activity.getString(R.string.check_allowed), activity.getString(allowed ? R.string.answer_yes : R.string.answer_no_loud), allowed ? GREEN : RED);
        int volume = notificationVolume(activity);
        row(activity, phone, activity.getString(R.string.check_volume), volume + " %", volume == 0 ? RED : 0);
        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(volume);
        phone.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (8 * density)));
        // "Notify this app": set here, so it does not have to be set on the Settings page. The page registers or forgets this phone.
        LinearLayout deviceRow = new LinearLayout(activity);
        deviceRow.setOrientation(LinearLayout.HORIZONTAL);
        deviceRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView deviceValue = row(activity, deviceRow, activity.getString(R.string.check_notify_app), "…", GRAY);
        ((View) deviceValue.getParent()).setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Button deviceButton = new Button(activity);
        deviceButton.setAllCaps(false);
        deviceButton.setTextSize(12);
        deviceButton.setMinHeight(0);
        deviceButton.setMinimumHeight(0);
        deviceButton.setVisibility(View.GONE);
        deviceRow.addView(deviceButton, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, (int) (36 * density)));
        phone.addView(deviceRow);
        TextView deviceNote = note(activity, activity.getString(R.string.check_registered_note));
        phone.addView(deviceNote);
        // hide the text of a message on the lock screen: stored on the account by the page
        final boolean[] setting = {false}; // the switch is being set from the page's answer: not a change of the person
        SwitchCompat hide = new SwitchCompat(activity);
        hide.setText(R.string.check_hide_text);
        hide.setTextSize(13);
        hide.setPadding(0, (int) (5 * density), 0, (int) (5 * density));
        hide.setOnCheckedChangeListener((view, on) -> {
            if (!setting[0]) notices.setHideText(on);
        });
        phone.addView(hide);
        TextView appVolume = row(activity, phone, activity.getString(R.string.check_app_volume), "…", GRAY);
        long when = Channels.lastSyncTime(activity);
        row(activity, phone, activity.getString(R.string.check_last_told), when == 0 ? activity.getString(R.string.check_never) : DateFormat.format("HH:mm:ss", new Date(when)).toString(), when == 0 ? RED : 0);
        form.addView(phone);

        // a real test notification through the server
        LinearLayout test = card(activity, activity.getString(R.string.check_test));
        Button testButton = new Button(activity);
        testButton.setText(R.string.check_test_button);
        testButton.setAllCaps(false);
        TextView testResult = note(activity, "");
        notices.onTested = text -> {
            testButton.setEnabled(true);
            testResult.setText(text.isEmpty() ? activity.getString(R.string.check_no_answer) : text);
        };
        testButton.setOnClickListener(v -> {
            testButton.setEnabled(false);
            testResult.setText(R.string.check_sending);
            notices.test();
        });
        test.addView(testButton);
        test.addView(testResult);
        form.addView(test);

        // the answer of the page: this device's switch, hide the text, the app's volume
        notices.onAppState = json -> {
            try {
                JSONObject state = new JSONObject(json);
                if (state.has("error")) {
                    paint(deviceValue, "?", RED);
                    deviceNote.setText(state.getString("error"));
                    return;
                }
                showDevice(deviceValue, deviceButton, state.optBoolean("device"), notices);
                setting[0] = true;
                hide.setChecked(state.getJSONObject("notices").optBoolean("hideText"));
                setting[0] = false;
                paint(appVolume, state.optInt("volume") + " %", 0);
            } catch (JSONException e) {
                paint(deviceValue, "?", RED);
                deviceNote.setText(R.string.check_not_understood);
            }
        };
        // the answer to the button: this phone is on or off now
        notices.onDeviceSet = (on, problem) -> {
            showDevice(deviceValue, deviceButton, on, notices);
            deviceNote.setText(problem.isEmpty() ? activity.getString(R.string.check_registered_note) : problem);
        };
        notices.readApp();

        ScrollView scroll = new ScrollView(activity);
        scroll.addView(form);

        new AlertDialog.Builder(activity)
            .setTitle(R.string.check_title)
            .setView(scroll)
            .setPositiveButton(R.string.check_close, null)
            .setNegativeButton(R.string.check_refresh, (dialog, which) -> show(activity, notices))
            // the app and Android always agree: whatever Android has is stored in the app when this form is closed
            .setOnDismissListener(dialog -> {
                notices.onPushed = null;
                notices.onTested = null;
                notices.pushToApp();
            })
            .show();
    }

    /** "Notify this app": its value, and the button that turns it the other way. */
    private static void showDevice(TextView value, Button button, boolean on, NativeNotices notices) {
        paint(value, value.getContext().getString(on ? R.string.state_on : R.string.state_off), on ? GREEN : RED);
        button.setText(on ? R.string.check_turn_off : R.string.check_turn_on);
        button.setVisibility(View.VISIBLE);
        button.setEnabled(true);
        button.setOnClickListener(v -> {
            button.setEnabled(false);
            notices.setDevice(!on);
        });
    }

    private static void paint(TextView text, String value, int color) {
        text.setText(value);
        text.setTextColor(color == 0 ? 0xFF202020 : color);
    }

    /** A small grey line of explanation (or red, when painted so). */
    private static TextView note(Context context, String text) {
        TextView note = new TextView(context);
        note.setText(text);
        note.setTextSize(12);
        note.setTextColor(GRAY);
        note.setPadding(0, (int) (4 * context.getResources().getDisplayMetrics().density), 0, 0);
        return note;
    }

    /** A rounded box with a heading. */
    private static LinearLayout card(Context context, String title) {
        float density = context.getResources().getDisplayMetrics().density;
        int pad = (int) (8 * density);
        LinearLayout card = new LinearLayout(context);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(pad + pad / 2, pad, pad + pad / 2, pad);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(10 * density);
        shape.setStroke((int) Math.max(1, density), 0xFFD0D0D0);
        shape.setColor(Color.WHITE);
        card.setBackground(shape);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = pad;
        card.setLayoutParams(params);
        TextView heading = new TextView(context);
        heading.setText(title);
        heading.setTextSize(14);
        heading.setTextColor(0xFF202020);
        heading.setTypeface(heading.getTypeface(), android.graphics.Typeface.BOLD);
        heading.setPadding(0, 0, 0, pad / 4);
        card.addView(heading);
        return card;
    }

    /** One field: its name on the left, its value on the right (in `color`, when one is given). */
    private static TextView row(Context context, LinearLayout card, String label, String value, int color) {
        float density = context.getResources().getDisplayMetrics().density;
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, (int) (5 * density), 0, (int) (5 * density));
        TextView name = new TextView(context);
        name.setText(label);
        name.setTextSize(13);
        name.setTextColor(GRAY);
        row.addView(name, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView text = new TextView(context);
        text.setText(value);
        text.setTextSize(13);
        text.setGravity(Gravity.END);
        text.setTextIsSelectable(true);
        text.setTextColor(color == 0 ? 0xFF202020 : color);
        if (color != 0) text.setTypeface(text.getTypeface(), android.graphics.Typeface.BOLD);
        row.addView(text, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.4f));
        card.addView(row);
        return text;
    }

    private static String importance(int importance) {
        switch (importance) {
            case NotificationManager.IMPORTANCE_NONE: return "none";
            case NotificationManager.IMPORTANCE_MIN: return "min";
            case NotificationManager.IMPORTANCE_LOW: return "low";
            case NotificationManager.IMPORTANCE_DEFAULT: return "default";
            case NotificationManager.IMPORTANCE_HIGH: return "high";
            default: return String.valueOf(importance);
        }
    }
}
