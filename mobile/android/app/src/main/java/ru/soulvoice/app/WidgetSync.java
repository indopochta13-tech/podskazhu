package ru.soulvoice.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Подтянуть полный state с сервера в кэш виджета без WebView.
 * Нужен после обновления APK (PACKAGE_REPLACED), чтобы заметки не «слетали».
 */
final class WidgetSync {
    private static final String TAG = "WidgetSync";

    private WidgetSync() {}

    static void refreshFromServer(Context context) {
        try {
            String token = WidgetApi.token(context);
            if (token == null || token.isEmpty()) {
                Log.i(TAG, "skip: no token");
                return;
            }
            JSONObject state = WidgetApi.request(context, "GET", "/api/state", null);
            WidgetApi.applyStateToWidget(context, state);
            JSONArray items = state.optJSONArray("items");
            ReminderScheduler.scheduleItems(context, items);
            SoulVoiceWidget.refresh(context);
            Log.i(TAG, "widget restored from server");
        } catch (Exception e) {
            Log.w(TAG, "restore failed: " + e.getMessage());
        }
    }
}
