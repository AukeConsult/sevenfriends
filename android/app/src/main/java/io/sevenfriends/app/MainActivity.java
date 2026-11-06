package io.sevenfriends.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ServiceWorkerController;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    /**
     * Android shows the push itself while the app is closed; a tap starts the app with the push's data as extras,
     * and "url" is the page the push is about (a path such as "/friends/abc", see functions/src/push.ts).
     */
    private static final String EXTRA_URL = "url";

    private NativeNotices nativeNotices;

    /** The bar at the top of the app with the button that opens NativeCheck. For checking the notifications: set to false to remove it. */
    private static final boolean CHECK_BAR = true;

    @Override
    public void onResume() {
        super.onResume();
        if (nativeNotices != null) {
            nativeNotices.pushToApp(); // and the app is given what Android has now (nothing is sent when it is the same as last time)
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Channels.ensure(this);
        // the page (settings.ts) opens the native notification screen through this
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(nativeNotices = new NativeNotices(this, getBridge().getWebView()), NativeNotices.NAME);
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) loadFresh();
        if (CHECK_BAR) addCheckBar();
        openPageFromIntent(getIntent(), 2500); // cold start: wait for the page to load
    }

    /**
     * A debug build (what Android Studio and the publishApk task make) always reads the web app fresh when the app opens: the app shows
     * the live website (capacitor.config.json: server.url), and a cached copy of an older version would hide what was just deployed.
     * The cache of the page and of its service worker is emptied and not used; the sign-in and the stored settings are NOT cleared.
     */
    private void loadFresh() {
        final WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        web.clearCache(true);
        web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.reload(); // the first load may already have started with the old cache
    }

    /** A thin bar above the whole app (the web page is below it) with a button for NativeCheck: what Android has, read by the Java code. */
    private void addCheckBar() {
        ViewGroup content = findViewById(android.R.id.content);
        if (content == null || content.getChildCount() == 0) return;
        View app = content.getChildAt(0);
        content.removeView(app);

        float density = getResources().getDisplayMetrics().density;
        int pad = (int) (8 * density);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(0xFF263238);
        bar.setPadding(pad * 2, pad / 2, pad, pad / 2);
        TextView title = new TextView(this);
        title.setText("Seven Friends · Android");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(13);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button check = new Button(this);
        check.setText(R.string.check_notifications);
        check.setTextSize(12);
        check.setAllCaps(false);
        check.setMinHeight(0);
        check.setMinimumHeight(0);
        check.setOnClickListener(v -> {
            if (nativeNotices != null) NativeCheck.show(this, nativeNotices);
        });
        bar.addView(check, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (int) (36 * density)));

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        column.addView(app, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        content.addView(column, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // the app draws under the status bar: the bar keeps clear of it
        ViewCompat.setOnApplyWindowInsetsListener(bar, (view, windowInsets) -> {
            Insets top = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars());
            view.setPadding(pad * 2, top.top + pad / 2, pad, pad / 2);
            return windowInsets;
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openPageFromIntent(intent, 0);
    }

    private void openPageFromIntent(Intent intent, long delayMs) {
        if (intent == null) return;
        String url = intent.getStringExtra(EXTRA_URL);
        if (url == null) url = pathOfWebsiteLink(intent.getData()); // a link of the website opened the app (see the intent filter in the manifest)
        if (url == null || !url.startsWith("/") || url.startsWith("//")) return; // only pages of the app itself
        intent.removeExtra(EXTRA_URL);
        intent.setData(null); // used once
        final WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web == null) return;
        final String js = "window.location.assign(" + JSONObject.quote(url) + ")";
        web.postDelayed(() -> web.evaluateJavascript(js, null), delayMs);
    }

    /**
     * A friend invitation or the email sign-in link, opened from the browser or a message: the app shows the live website, so the
     * page of the link (path and query) is opened in it. The web app reads the invitation from the address (friend-link.service.ts).
     */
    private static String pathOfWebsiteLink(Uri link) {
        if (link == null || !"https".equals(link.getScheme())) return null;
        String host = link.getHost();
        if (!"sevenfriends.web.app".equals(host) && !"sevenfriends.io".equals(host)) return null;
        String path = link.getEncodedPath() == null || link.getEncodedPath().isEmpty() ? "/" : link.getEncodedPath();
        return link.getEncodedQuery() == null ? path : path + "?" + link.getEncodedQuery();
    }
}
