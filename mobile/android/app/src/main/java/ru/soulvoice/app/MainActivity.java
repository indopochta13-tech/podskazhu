package ru.soulvoice.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridge.class);
        registerPlugin(MicBridge.class);
        registerPlugin(UpdateBridge.class);
        registerPlugin(BatteryOptimizationBridge.class);
        super.onCreate(savedInstanceState);
        WidgetBridge.remember(getIntent());
        clearWebCacheIfUpdated();
    }

    /** После обновления APK WebView может держать старый app.js — сбрасываем кэш один раз. */
    private void clearWebCacheIfUpdated() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            SharedPreferences prefs = getSharedPreferences("vc_boot", MODE_PRIVATE);
            long last = prefs.getLong("lastVersionCode", 0);
            if (code <= last) return;
            prefs.edit().putLong("lastVersionCode", code).apply();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    if (getBridge() == null || getBridge().getWebView() == null) return;
                    WebView webView = getBridge().getWebView();
                    webView.clearCache(true);
                } catch (Exception ignored) {
                }
            }, 300);
        } catch (PackageManager.NameNotFoundException ignored) {
        }
    }

    // Приложение живёт в одной задаче, поэтому повторные нажатия по виджету приходят сюда.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        WidgetBridge.remember(intent);
    }
}
