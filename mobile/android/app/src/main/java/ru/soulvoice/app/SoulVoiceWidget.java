package ru.soulvoice.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Виджет со списком ListView — листается пальцем.
 * Превью (initialLayout) без ListView; сервис с BIND_REMOTEVIEWS.
 */
public class SoulVoiceWidget extends AppWidgetProvider {

    static final String PREFS = "soulvoice_widget";
    static final String KEY_DATA = "data";
    /** Сырые items/settings — чтобы пересобирать сводки ухода «за час до» без сети. */
    static final String KEY_STATE_ITEMS = "stateItems";
    static final String KEY_STATE_SETTINGS = "stateSettings";
    static final String KEY_TAB = "activeTab";
    static final String KEY_API = "apiBase";
    static final String KEY_TOKEN = "token";
    /** Последняя палитра снимка — переживает rebuild из сырого state без цветов. */
    static final String KEY_LOOK = "look";
    static final String ACTION_TAP = "ru.soulvoice.app.WIDGET_TAP";
    static final String ACTION_TAB = "ru.soulvoice.app.WIDGET_TAB";
    static final String EXTRA_ACTION = "vc_widget_action";
    static final String EXTRA_SHELF = "vc_widget_shelf";
    static final String EXTRA_ITEM = "vc_widget_item";
    static final String EXTRA_SHARED_LIST = "vc_widget_shared_list";
    static final String EXTRA_PAIR_ID = "vc_widget_pair_id";

    private static final int[] TAB_LABEL_IDS = {
            R.id.widget_tab_0, R.id.widget_tab_1, R.id.widget_tab_2, R.id.widget_tab_3
    };
    private static final int[] TAB_BG_IDS = {
            R.id.widget_tab_0_bg, R.id.widget_tab_1_bg, R.id.widget_tab_2_bg, R.id.widget_tab_3_bg
    };

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_TAB.equals(intent.getAction())) {
            String tab = intent.getStringExtra(EXTRA_SHELF);
            if (tab != null && !tab.isEmpty()) {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_TAB, tab)
                        .apply();
                refresh(context);
            }
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        rebuildCareAwareSnapshot(context);
        for (int widgetId : widgetIds) render(context, manager, widgetId);
        manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.widget_list);
    }

    @Override
    public void onAppWidgetOptionsChanged(
            Context context, AppWidgetManager manager, int widgetId, Bundle newOptions
    ) {
        render(context, manager, widgetId);
    }

    @Override
    public void onEnabled(Context context) {
        refresh(context);
    }

    /** Пересобрать снимок из кэша state — утро/вечер косметики появляются за час до времени. */
    static void rebuildCareAwareSnapshot(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String itemsRaw = prefs.getString(KEY_STATE_ITEMS, "");
        if (itemsRaw == null || itemsRaw.isEmpty()) return;
        try {
            JSONArray items = new JSONArray(itemsRaw);
            String settingsRaw = prefs.getString(KEY_STATE_SETTINGS, "");
            JSONObject settings = settingsRaw != null && !settingsRaw.isEmpty()
                    ? new JSONObject(settingsRaw) : null;
            String prev = prefs.getString(KEY_DATA, "");
            JSONObject prevSnap = null;
            try {
                if (prev != null && !prev.isEmpty()) prevSnap = new JSONObject(prev);
            } catch (Exception ignored) {}
            JSONObject lookCache = null;
            String lookRaw = prefs.getString(KEY_LOOK, "");
            try {
                if (lookRaw != null && !lookRaw.isEmpty()) lookCache = new JSONObject(lookRaw);
            } catch (Exception ignored) {}
            JSONObject snap = WidgetSnapshotBuilder.build(items, settings);
            // Палитра: settings.widgetLook → кэш KEY_LOOK → предыдущий снимок.
            WidgetLook.mergeInto(snap, settings, lookCache != null ? lookCache : prevSnap);
            String next = snap.toString();
            // Пустышка чужого builder'а не затирает; наш сборщик (в т.ч. пустой после
            // удаления последней заметки) — всегда пишем.
            if (!WidgetSnapshotBuilder.shouldReplace(prev, next)) return;
            SharedPreferences.Editor edit = prefs.edit().putString(KEY_DATA, next);
            if (WidgetLook.hasColors(snap)) {
                edit.putString(KEY_LOOK, WidgetLook.extract(snap).toString());
            }
            edit.commit();
        } catch (Exception ignored) {}
    }

    static void refresh(Context context) {
        rebuildCareAwareSnapshot(context);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] widgetIds = manager.getAppWidgetIds(new ComponentName(context, SoulVoiceWidget.class));
        for (int widgetId : widgetIds) render(context, manager, widgetId);
        if (widgetIds.length > 0) {
            manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.widget_list);
        }
    }

    private static void render(Context context, AppWidgetManager manager, int widgetId) {
        try {
            renderInner(context, manager, widgetId);
        } catch (Exception e) {
            renderFallback(context, manager, widgetId);
        }
    }

    /** Минимальный виджет без bitmap/tint — если полный render упал. */
    private static void renderFallback(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_soulvoice);
        views.setTextViewText(R.id.widget_left_label, "Общие списки");
        views.setTextViewText(R.id.widget_right_label, "");
        views.setViewVisibility(R.id.widget_right, View.GONE);
        views.setViewVisibility(R.id.widget_month_label, View.GONE);
        views.setViewVisibility(R.id.widget_day_label, View.GONE);
        views.setViewVisibility(R.id.widget_tab_2, View.GONE);
        views.setViewVisibility(R.id.widget_tab_3, View.GONE);
        views.setViewVisibility(R.id.widget_tab_0_bg, View.GONE);
        views.setViewVisibility(R.id.widget_tab_1_bg, View.GONE);

        Intent listIntent = new Intent(context, WidgetListService.class);
        listIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        listIntent.setData(Uri.parse(listIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, listIntent);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        Intent template = new Intent(context, WidgetRowActionActivity.class);
        template.setAction(ACTION_TAP);
        template.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(
                context, 100 + widgetId, template,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        ));
        views.setOnClickPendingIntent(R.id.widget_left, tap(context, 2, "left", "shared", ""));
        views.setOnClickPendingIntent(R.id.widget_record, recordTap(context, 3));
        views.setOnClickPendingIntent(R.id.widget_right, tap(context, 4, "right", "", ""));
        manager.updateAppWidget(widgetId, views);
    }

    private static void renderInner(Context context, AppWidgetManager manager, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_DATA, "");

        String leftLabel = "Общие списки";
        String leftId = "shared";
        String rightLabel = "";
        String rightId = "";
        JSONArray tabs = new JSONArray();
        JSONObject data = null;

        if (raw != null && !raw.isEmpty()) {
            try {
                data = new JSONObject(raw);
                JSONObject left = data.optJSONObject("leftBtn");
                if (left != null) {
                    leftId = left.optString("id", leftId);
                    leftLabel = left.optString("label", leftLabel);
                }
                JSONObject right = data.optJSONObject("rightBtn");
                if (right != null) {
                    rightId = right.optString("id", rightId);
                    rightLabel = right.optString("label", rightLabel);
                } else {
                    rightId = data.optString("shelfId", rightId);
                    rightLabel = data.optString("shelfLabel", rightLabel);
                }
                tabs = data.optJSONArray("tabs");
                if (tabs == null) tabs = new JSONArray();
            } catch (Exception ignored) {
                // Битые данные не должны ронять виджет.
            }
        }

        String activeTab = resolveActiveTab(prefs, tabs);
        WidgetLook look = WidgetLook.fromSnapshot(data);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_soulvoice);
        bindSideButton(context, views, R.id.widget_left, 2, "left", leftId, leftLabel);
        bindSideButton(context, views, R.id.widget_right, 4, "right", rightId, rightLabel);
        views.setViewVisibility(R.id.widget_month_label, View.GONE);
        views.setViewVisibility(R.id.widget_day_label, View.GONE);
        views.setViewVisibility(R.id.widget_tab_2, View.GONE);
        views.setViewVisibility(R.id.widget_tab_3, View.GONE);

        Bundle opts = manager.getAppWidgetOptions(widgetId);
        int widthDp = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180) : 180;
        int heightDp = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180) : 180;
        look.applyChrome(context, views, widthDp, heightDp, leftId, rightId);
        bindDayChips(context, views, tabs, activeTab, look, widthDp);

        Intent listIntent = new Intent(context, WidgetListService.class);
        listIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        listIntent.setData(Uri.parse(listIntent.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, listIntent);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        Intent template = new Intent(context, WidgetRowActionActivity.class);
        template.setAction(ACTION_TAP);
        template.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(
                context,
                100 + widgetId,
                template,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        ));

        views.setOnClickPendingIntent(R.id.widget_record, recordTap(context, 3));

        manager.updateAppWidget(widgetId, views);
    }

    private static void bindSideButton(
            Context context, RemoteViews views, int containerId, int requestCode,
            String side, String id, String label
    ) {
        if (id == null || id.isEmpty() || "none".equals(id)) {
            views.setViewVisibility(containerId, View.GONE);
            return;
        }
        views.setViewVisibility(containerId, View.VISIBLE);
        int labelId = "left".equals(side) ? R.id.widget_left_label : R.id.widget_right_label;
        views.setTextViewText(labelId, label);
        PendingIntent pi = "shared".equals(id)
                ? sharedRecordTap(context, requestCode, id)
                : tap(context, requestCode, side, id, "");
        views.setOnClickPendingIntent(containerId, pi);
    }

    private static void bindDayChips(
            Context context, RemoteViews views, JSONArray tabs, String activeTab,
            WidgetLook look, int widgetWidthDp
    ) {
        int chipWidthDp = Math.max(72, (widgetWidthDp - 12) / 2);
        for (int i = 0; i < TAB_LABEL_IDS.length; i += 1) {
            int labelId = TAB_LABEL_IDS[i];
            int bgId = TAB_BG_IDS[i];
            if (tabs == null || i >= tabs.length() || i >= 2) {
                views.setViewVisibility(labelId, View.GONE);
                views.setViewVisibility(bgId, View.GONE);
                continue;
            }
            JSONObject tab = tabs.optJSONObject(i);
            if (tab == null) {
                views.setViewVisibility(labelId, View.GONE);
                views.setViewVisibility(bgId, View.GONE);
                continue;
            }
            String id = tab.optString("id", "");
            String label = tab.optString("label", id);
            if (id.isEmpty()) {
                views.setViewVisibility(labelId, View.GONE);
                views.setViewVisibility(bgId, View.GONE);
                continue;
            }
            boolean on = id.equals(activeTab);
            views.setViewVisibility(labelId, View.VISIBLE);
            views.setViewVisibility(bgId, View.VISIBLE);
            views.setTextViewText(labelId, label);
            look.applyDayChip(context, views, bgId, labelId, on, chipWidthDp);
            views.setOnClickPendingIntent(labelId, tabTap(context, 20 + i, id));
        }
    }

    static String resolveActiveTab(SharedPreferences prefs, JSONArray tabs) {
        String saved = prefs.getString(KEY_TAB, "");
        if (tabs != null) {
            for (int i = 0; i < tabs.length(); i += 1) {
                JSONObject tab = tabs.optJSONObject(i);
                if (tab == null) continue;
                String id = tab.optString("id", "");
                if (!id.isEmpty() && id.equals(saved)) return id;
            }
            JSONObject first = tabs.optJSONObject(0);
            if (first != null) {
                String id = first.optString("id", "");
                if (!id.isEmpty()) return id;
            }
        }
        return saved == null || saved.isEmpty() ? "today" : saved;
    }

    static boolean itemMatchesTab(JSONObject item, String tabId) {
        if (item == null || tabId == null || tabId.isEmpty()) return true;
        JSONArray tabs = item.optJSONArray("tabs");
        if (tabs == null || tabs.length() == 0) return true;
        for (int i = 0; i < tabs.length(); i += 1) {
            if (tabId.equals(tabs.optString(i))) return true;
        }
        return false;
    }

    private static PendingIntent tap(Context context, int code, String action, String shelf, String itemId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ACTION_TAP);
        intent.setData(Uri.parse("soulvoice://widget/" + action + "/" + shelf + "/" + itemId));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(EXTRA_ACTION, action);
        intent.putExtra(EXTRA_SHELF, shelf);
        intent.putExtra(EXTRA_ITEM, itemId);
        return PendingIntent.getActivity(context, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent sharedRecordTap(Context context, int code, String shelf) {
        Intent intent = new Intent(context, WidgetRecordActivity.class);
        intent.setAction(ACTION_TAP);
        intent.setData(Uri.parse("soulvoice://widget/shared-record"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(EXTRA_SHARED_LIST, true);
        intent.putExtra(EXTRA_SHELF, shelf);
        String pairId = "";
        try {
            String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DATA, "");
            if (raw != null && !raw.isEmpty()) {
                JSONObject data = new JSONObject(raw);
                pairId = data.optString("sharedListDefault", "");
            }
        } catch (Exception ignored) {}
        intent.putExtra(EXTRA_PAIR_ID, pairId == null ? "" : pairId);
        return PendingIntent.getActivity(context, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent recordTap(Context context, int code) {
        Intent intent = new Intent(context, WidgetRecordActivity.class);
        intent.setAction(ACTION_TAP);
        intent.setData(Uri.parse("soulvoice://widget/record"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent tabTap(Context context, int code, String tabId) {
        Intent intent = new Intent(context, SoulVoiceWidget.class);
        intent.setAction(ACTION_TAB);
        intent.setData(Uri.parse("soulvoice://widget-tab/" + tabId));
        intent.putExtra(EXTRA_SHELF, tabId);
        return PendingIntent.getBroadcast(context, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
