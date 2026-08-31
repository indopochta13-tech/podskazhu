package ru.soulvoice.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/** Связь веб-части с виджетом: отдать ему свежие записи и забрать нажатие по кнопке. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridge extends Plugin {

    // Нажатие приходит раньше, чем веб-часть успевает загрузиться, поэтому ждёт здесь.
    private static String pendingAction = "";
    private static String pendingShelf = "";
    private static String pendingItem = "";

    static void remember(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(SoulVoiceWidget.EXTRA_ACTION);
        if (action == null || action.isEmpty()) return;
        pendingAction = action;
        pendingShelf = orEmpty(intent.getStringExtra(SoulVoiceWidget.EXTRA_SHELF));
        pendingItem = orEmpty(intent.getStringExtra(SoulVoiceWidget.EXTRA_ITEM));
        // Иначе то же нажатие сработает ещё раз при следующем возвращении в приложение.
        intent.removeExtra(SoulVoiceWidget.EXTRA_ACTION);
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
        String payload = call.getString("payload", null);
        SharedPreferences.Editor edit = prefs.edit();

        String apiBase = call.getString("apiBase", "");
        if (apiBase != null && !apiBase.isEmpty()) {
            edit.putString(SoulVoiceWidget.KEY_API, apiBase.replaceAll("/+$", ""));
        }
        String token = call.getString("token", "");
        if (token != null && !token.isEmpty()) {
            edit.putString(SoulVoiceWidget.KEY_TOKEN, token);
        }

        // Пустой payload — только токен/api (старт приложения), список виджета не трогаем.
        boolean hasPayload = payload != null && !payload.isEmpty();
        if (hasPayload) {
            // Защита: пустышка «Пока пусто» не затирает живые записи после обновления APK.
            if (WidgetApi.shouldReplaceWidgetData(prefs.getString(SoulVoiceWidget.KEY_DATA, ""), payload)) {
                edit.putString(SoulVoiceWidget.KEY_DATA, payload);
            }
            // Палитра из веб-снимка — отдельно, чтобы rebuild из state её не стёр.
            try {
                JSONObject snap = new JSONObject(payload);
                if (WidgetLook.hasColors(snap)) {
                    edit.putString(SoulVoiceWidget.KEY_LOOK, WidgetLook.extract(snap).toString());
                }
            } catch (Exception ignored) {}
        }
        String stateItems = call.getString("stateItems", "");
        if (stateItems != null && !stateItems.isEmpty()) {
            edit.putString(SoulVoiceWidget.KEY_STATE_ITEMS, stateItems);
            try {
                CareWidgetScheduler.schedule(context, new JSONArray(stateItems));
            } catch (Exception ignored) {}
        }
        String stateSettings = call.getString("stateSettings", "");
        if (stateSettings != null && !stateSettings.isEmpty()) {
            edit.putString(SoulVoiceWidget.KEY_STATE_SETTINGS, stateSettings);
        }

        edit.apply();
        if (hasPayload) SoulVoiceWidget.refresh(context);
        call.resolve();
    }

    /** Просит систему поставить виджет на рабочий стол: искать его в общем списке не придётся. */
    @PluginMethod
    public void pin(PluginCall call) {
        setProviderEnabled(true);
        JSObject result = new JSObject();
        AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
        ComponentName provider = new ComponentName(getContext(), SoulVoiceWidget.class);
        int[] ids = manager.getAppWidgetIds(provider);
        int count = ids == null ? 0 : ids.length;
        boolean supported = manager.isRequestPinAppWidgetSupported();
        result.put("supported", supported);
        result.put("count", count);
        if (count > 0) {
            // Уже на экране — диалог не нужен.
            result.put("asked", false);
            result.put("already", true);
            SoulVoiceWidget.refresh(getContext());
            call.resolve(result);
            return;
        }
        result.put("already", false);
        if (!supported) {
            // Xiaomi/Huawei и др.: pin API запрещён — честно говорим веб-части.
            result.put("asked", false);
            call.resolve(result);
            return;
        }
        // successCallback = null: факт добавления веб проверяет через status() после возврата.
        boolean asked = manager.requestPinAppWidget(provider, null, null);
        result.put("asked", asked);
        call.resolve(result);
    }

    /**
     * Выключает провайдер виджета — система убирает его с рабочего стола.
     * Включает обратно через pin().
     */
    @PluginMethod
    public void unpin(PluginCall call) {
        setProviderEnabled(false);
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();
        ComponentName provider = new ComponentName(context, SoulVoiceWidget.class);
        int state = pm.getComponentEnabledSetting(provider);
        boolean enabled = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                || state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT;
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = enabled ? manager.getAppWidgetIds(provider) : new int[0];
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        result.put("count", ids == null ? 0 : ids.length);
        call.resolve(result);
    }

    private void setProviderEnabled(boolean on) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();
        ComponentName provider = new ComponentName(context, SoulVoiceWidget.class);
        pm.setComponentEnabledSetting(
                provider,
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
        );
    }

    @PluginMethod
    public void takeAction(PluginCall call) {
        JSObject result = new JSObject();
        result.put("action", pendingAction);
        result.put("shelf", pendingShelf);
        result.put("item", pendingItem);
        pendingAction = "";
        pendingShelf = "";
        pendingItem = "";
        call.resolve(result);
    }
}
