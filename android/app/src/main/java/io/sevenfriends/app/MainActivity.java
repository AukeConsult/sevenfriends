package io.sevenfriends.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    /**
     * Android shows the push itself while the app is closed; a tap starts the app with the push's data as extras,
     * and "url" is the page the push is about (a path such as "/friends/abc", see functions/src/push.ts).
     */
    private static final String EXTRA_URL = "url";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Channels.ensure(this);
        openPageFromIntent(getIntent(), 2500); // cold start: wait for the page to load
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openPageFromIntent(intent, 0);
    }

    private void openPageFromIntent(Intent intent, long delayMs) {
        if (intent == null) return;
        String url = intent.getStringExtra(EXTRA_URL);
        if (url == null || !url.startsWith("/") || url.startsWith("//")) return; // only pages of the app itself
        intent.removeExtra(EXTRA_URL);
        final WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        final String js = "window.location.assign(" + JSONObject.quote(url) + ")";
        web.postDelayed(() -> web.evaluateJavascript(js, null), delayMs);
    }
}
