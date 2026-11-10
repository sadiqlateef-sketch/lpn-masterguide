package com.lpnmasterguide.app;

import android.content.res.Configuration;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Android's WebView ignores the phone's font size setting unless the app passes it on.
    // Scale the app's text to match (Settings > Display > Font size), capped so layouts still fit.
    private static final int MIN_TEXT_ZOOM = 85;
    private static final int MAX_TEXT_ZOOM = 200;

    static int textZoomFor(float fontScale) {
        int zoom = Math.round(fontScale * 100f);
        return Math.max(MIN_TEXT_ZOOM, Math.min(MAX_TEXT_ZOOM, zoom));
    }

    private void applyTextZoom(Configuration configuration) {
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.getSettings().setTextZoom(textZoomFor(configuration.fontScale));
    }

    @Override
    public void onResume() {
        super.onResume();
        applyTextZoom(getResources().getConfiguration());
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyTextZoom(newConfig);
    }
}
