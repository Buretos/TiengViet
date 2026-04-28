package com.vietapp.learn;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.vietapp.plugin.BackgroundTtsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewAlive();
    }

    private void keepWebViewAlive() {
        // Capacitor's BridgeActivity calls webView.pauseTimers() + webView.onPause()
        // when the activity goes to background, which kills HTML5 audio + setTimeout
        // a few seconds (or up to a minute) after the screen turns off.
        // While AutoPlay is active, BackgroundTtsPlugin.isBackgroundActive() is true,
        // so we undo that pause to keep TTS playing with the screen locked.
        if (!BackgroundTtsPlugin.isBackgroundActive()) return;
        try {
            WebView webView = (this.bridge != null) ? this.bridge.getWebView() : null;
            if (webView != null) {
                webView.resumeTimers();
                webView.onResume();
            }
        } catch (Throwable ignored) {
            // never crash here — losing background-keep is recoverable, a crash is not
        }
    }
}
