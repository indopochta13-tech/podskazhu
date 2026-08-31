package ru.soulvoice.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Общие запросы виджета к API без открытия WebView. */
final class WidgetApi {
    static final String DEFAULT_API = "https://soulvoicee.ru";

    private WidgetApi() {}

    static String token(Context context) {
        SharedPreferences caps = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String token = caps.getString("token", "");
        if (token != null && !token.isEmpty()) return token;
        SharedPreferences widget = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
        return widget.getString(SoulVoiceWidget.KEY_TOKEN, "");
    }

    static String apiBase(Context context) {
        SharedPreferences widget = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
        String base = widget.getString(SoulVoiceWidget.KEY_API, "");
        if (base != null && !base.isEmpty()) return base.replaceAll("/+$", "");
        return DEFAULT_API;
    }

    static JSONObject request(Context context, String method, String path, JSONObject body) throws Exception {
        String token = token(context);
        if (token == null || token.isEmpty()) throw new Exception("Сначала откройте приложение и войдите");
        String url = apiBase(context) + path;
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (body != null) {
            conn.setDoOutput(true);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
        }
        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String raw = readAll(stream);
        conn.disconnect();
        JSONObject json;
        try {
            json = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
        } catch (Exception e) {
            json = new JSONObject();
        }
        if (code >= 400) throw new Exception(json.optString("error", "Ошибка " + code));
        return json;
    }

    /** true — можно заменить кэш виджета. */
    static boolean shouldReplaceWidgetData(String oldRaw, String newRaw) {
        return WidgetSnapshotBuilder.shouldReplace(oldRaw, newRaw);
    }

    /**
     * Единый путь записи после sync / mic / PACKAGE_REPLACED:
     * только WidgetSnapshotBuilder, без второго «урезанного» сериализатора.
     */
    static void applyStateToWidget(Context context, JSONObject state) {
        SharedPreferences prefs = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray items = state != null ? state.optJSONArray("items") : null;
            JSONObject user = state != null ? state.optJSONObject("user") : null;
            JSONObject settings = user != null ? user.optJSONObject("settings") : null;
            if (settings == null && state != null) settings = state.optJSONObject("settings");
            SharedPreferences.Editor edit = prefs.edit();
            // Сырой state — источник истины для refresh/будильника.
            if (items != null) edit.putString(SoulVoiceWidget.KEY_STATE_ITEMS, items.toString());
            if (settings != null) edit.putString(SoulVoiceWidget.KEY_STATE_SETTINGS, settings.toString());
            edit.commit();
            CareWidgetScheduler.schedule(context, items);
            // Снимок пересоберём из KEY_STATE_ITEMS — так alarm сразу виден на иконке.
            SoulVoiceWidget.refresh(context);
        } catch (Exception ignored) {
            // Битый state не должен ронять виджет / затирать кэш.
        }
    }

    /**
     * Быстрый локальный патч: правим и сырой state, и снимок.
     * Иначе refresh() пересоберёт KEY_DATA из устаревшего KEY_STATE_ITEMS и откатит будильник.
     */
    static void patchLocalItem(Context context, String itemId, Boolean alarm, boolean remove) {
        if (itemId == null || itemId.isEmpty()) return;
        patchStateItems(context, itemId, alarm, remove, null);
        // Пересобираем снимок из актуального state — иконка и список совпадут с сервером.
        SoulVoiceWidget.refresh(context);
    }

    /** Обновить одну запись из ответа сервера после PATCH (без полного items[]). */
    static void mergeLocalItem(Context context, JSONObject serverItem) {
        if (serverItem == null) return;
        String itemId = serverItem.optString("id", "");
        if (itemId.isEmpty()) return;
        Boolean alarm = serverItem.has("alarm") ? serverItem.optBoolean("alarm") : null;
        boolean remove = serverItem.optBoolean("cancelled", false) || serverItem.optBoolean("archived", false);
        patchStateItems(context, itemId, alarm, remove, serverItem);
        SoulVoiceWidget.refresh(context);
    }

    /** Полный item для AlarmManager — из сырого state, не из укороченной строки снимка. */
    static JSONObject findLocalItem(Context context, String itemId) {
        if (itemId == null || itemId.isEmpty()) return null;
        try {
            SharedPreferences prefs = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
            String stateRaw = prefs.getString(SoulVoiceWidget.KEY_STATE_ITEMS, "");
            JSONObject fromState = findInArray(stateRaw, itemId);
            if (fromState != null) return fromState;
            String snapRaw = prefs.getString(SoulVoiceWidget.KEY_DATA, "");
            if (snapRaw == null || snapRaw.isEmpty()) return null;
            JSONArray items = new JSONObject(snapRaw).optJSONArray("items");
            return findInJsonArray(items, itemId);
        } catch (Exception ignored) {
            return null;
        }
    }

    /** Текущий alarm из сырого state (источник истины для переключателя). */
    static boolean localAlarm(Context context, String itemId) {
        JSONObject item = findLocalItem(context, itemId);
        return item != null && item.optBoolean("alarm", false);
    }

    private static void patchStateItems(
            Context context,
            String itemId,
            Boolean alarm,
            boolean remove,
            JSONObject serverItem
    ) {
        SharedPreferences prefs = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(SoulVoiceWidget.KEY_STATE_ITEMS, "");
        if (raw == null || raw.isEmpty()) return;
        try {
            JSONArray items = new JSONArray(raw);
            JSONArray next = new JSONArray();
            boolean found = false;
            for (int i = 0; i < items.length(); i += 1) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                if (!itemId.equals(item.optString("id"))) {
                    next.put(item);
                    continue;
                }
                found = true;
                if (remove) continue;
                if (serverItem != null) {
                    // Подмешиваем поля с сервера, сохраняя id.
                    JSONObject merged = new JSONObject(item.toString());
                    JSONArray names = serverItem.names();
                    if (names != null) {
                        for (int n = 0; n < names.length(); n += 1) {
                            String key = names.optString(n);
                            if (key != null && !key.isEmpty()) merged.put(key, serverItem.get(key));
                        }
                    }
                    next.put(merged);
                } else {
                    if (alarm != null) item.put("alarm", alarm.booleanValue());
                    next.put(item);
                }
            }
            if (!found && !remove) return;
            // commit: удаление с виджета не должно «откладываться» и откатываться refresh'ем.
            prefs.edit().putString(SoulVoiceWidget.KEY_STATE_ITEMS, next.toString()).commit();
        } catch (Exception ignored) {}
    }

    private static JSONObject findInArray(String raw, String itemId) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            return findInJsonArray(new JSONArray(raw), itemId);
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject findInJsonArray(JSONArray items, String itemId) {
        if (items == null) return null;
        for (int i = 0; i < items.length(); i += 1) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && itemId.equals(item.optString("id"))) return item;
        }
        return null;
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }
}
