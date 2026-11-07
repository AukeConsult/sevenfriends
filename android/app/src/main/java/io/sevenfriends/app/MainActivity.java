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

    /** The height of the status bar over the web page, in dp (0 when the page starts below it): the page reads it as SfInsets.topDp() and pads its header. */
    private volatile int topInsetDp = 0;

    private final class Insets_ {
        @android.webkit.JavascriptInterface
        public int topDp() {
            return topInsetDp;
        }
    }

    /** The bar at the top of the app with the button that opens NativeCheck. For checking the notifications: set to false to remove it. */
    private static final boolean CHECK_BAR = false;

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
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Insets_(), "SfInsets");
        }
        if (getBridge() != null && getBridge().getWebView() != null && android.os.Build.VERSION.SDK_INT >= 29) {
            // the page has its own themes (light, dark, ...): a phone in dark mode must not darken it again (that turns the colours and the text colours wrong)
            getBridge().getWebView().getSettings().setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) loadFresh();
        if (CHECK_BAR) addCheckBar(); else trackStatusBar();
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

    /** No bar of ours: the page draws under the status bar, so it is told how high the status bar is (it pads its header by that). */
    private void trackStatusBar() {
        ViewGroup content = findViewById(android.R.id.content);
        if (content == null) return;
        final float density = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets top = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout());
            topInsetDp = Math.round(top.top / density);
            final WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) web.evaluateJavascript("document.documentElement.style.setProperty('--sf-native-top','" + topInsetDp + "px')", null);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
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

        // the app draws under the status bar: the bar keeps clear of it, and the web page below the bar is told there is nothing
        // above it any more (otherwise its own safe-area padding adds a second status-bar-high gap under the bar)
        ViewCompat.setOnApplyWindowInsetsListener(column, (view, windowInsets) -> {
            Insets top = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout());
            bar.setPadding(pad * 2, top.top + pad / 2, pad, pad / 2);
            Insets status = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            return new WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(status.left, 0, status.right, status.bottom))
                    .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.of(cutout.left, 0, cutout.right, cutout.bottom))
                    .build();
        });
        ViewCompat.requestApplyInsets(column);
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
