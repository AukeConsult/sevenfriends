package io.sevenfriends.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The screen of a poke alarm: shown over the lock screen, turns the screen on. It says WHO is poking (their name, and the group for a group) and the text,
 * with two buttons: Stop (silences it) and Open (silences it and opens that friend's page). It closes by itself when the alarm is over.
 */
public class PokeActivity extends Activity {

    private final BroadcastReceiver done = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(done, new IntentFilter(PokeService.ACTION_DONE), Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(done, new IntentFilter(PokeService.ACTION_DONE));
        show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        show(intent); // another poke while this one rings: the screen shows the newest
    }

    private void show(Intent intent) {
        final String name = intent.getStringExtra(PokeService.EXTRA_NAME);
        final String text = intent.getStringExtra(PokeService.EXTRA_TEXT);
        final String url = intent.getStringExtra(PokeService.EXTRA_URL);
        float density = getResources().getDisplayMetrics().density;
        int pad = (int) (24 * density);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        column.setBackgroundColor(0xFF2F4B7C);
        column.setPadding(pad, pad, pad, pad);

        column.addView(label(getString(R.string.poke_from_label), 16, 0xCCFFFFFF, false));
        column.addView(label(name == null ? "" : name, 34, Color.WHITE, true)); // who is poking
        if (text != null && !text.isEmpty()) column.addView(label(text, 18, Color.WHITE, false));

        Button stop = new Button(this);
        stop.setText(R.string.poke_stop);
        stop.setOnClickListener(v -> {
            stopService(new Intent(this, PokeService.class));
            finish();
        });
        Button open = new Button(this);
        open.setText(R.string.poke_open);
        open.setOnClickListener(v -> {
            stopService(new Intent(this, PokeService.class));
            Intent main = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            if (url != null) main.putExtra("url", url);
            startActivity(main);
            finish();
        });
        LinearLayout.LayoutParams buttons = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (56 * density));
        buttons.topMargin = (int) (16 * density);
        column.addView(stop, buttons);
        column.addView(open, buttons);
        setContentView(column);
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        if (bold) view.setTypeface(null, Typeface.BOLD);
        view.setPadding(0, (int) (8 * getResources().getDisplayMetrics().density), 0, 0);
        return view;
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(done);
        super.onDestroy();
    }
}
