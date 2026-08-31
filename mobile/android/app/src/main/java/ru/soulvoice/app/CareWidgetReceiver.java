package ru.soulvoice.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Просыпается за час до ухода — пересобирает виджет из кэша / сервера. */
public class CareWidgetReceiver extends BroadcastReceiver {
    private static final String TAG = "CareWidgetReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        final Context app = context.getApplicationContext();
        // Быстро из кэша, затем подтянуть state (если сеть есть).
        SoulVoiceWidget.rebuildCareAwareSnapshot(app);
        SoulVoiceWidget.refresh(app);
        new Thread(() -> {
            try {
                WidgetSync.refreshFromServer(app);
            } catch (Exception e) {
                Log.w(TAG, "server refresh: " + e.getMessage());
            }
        }, "care-widget-refresh").start();
    }
}
