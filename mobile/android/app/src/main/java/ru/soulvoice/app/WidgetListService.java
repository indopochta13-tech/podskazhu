package ru.soulvoice.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Адаптер списка виджета: читает снимок и фильтрует по activeTab.
 * Не бросает исключения — иначе лаунчер пишет «Не удалось добавить виджет».
 */
public class WidgetListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        private final List<Row> rows = new ArrayList<>();

        Factory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            rows.clear();
            try {
                SharedPreferences prefs = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
                String raw = prefs.getString(SoulVoiceWidget.KEY_DATA, "");
                if (raw == null || raw.isEmpty()) return;
                JSONObject data = new JSONObject(raw);
                WidgetLook look = WidgetLook.fromSnapshot(data);
                JSONArray items = data.optJSONArray("items");
                if (items == null) return;
                JSONArray tabs = data.optJSONArray("tabs");
                String activeTab = SoulVoiceWidget.resolveActiveTab(prefs, tabs);
                int shown = 0;
                for (int i = 0; i < items.length(); i += 1) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    if (!SoulVoiceWidget.itemMatchesTab(item, activeTab)) continue;
                    String id = item.optString("id", "");
                    if (id.isEmpty()) continue;
                    String timeText = item.optString("timeText", "");
                    String whenLabel = item.optString("whenLabel", "");
                    if (!whenLabel.isEmpty()) {
                        timeText = whenLabel + (timeText.isEmpty() || "—".equals(timeText) ? "" : "\n" + timeText);
                        // RemoteViews TextView is single-line-ish; keep whenLabel in lab instead.
                        timeText = item.optString("timeText", "—");
                    }
                    String lab = item.optString("lab", "");
                    if (!whenLabel.isEmpty() && lab.isEmpty()) lab = whenLabel;
                    else if (!whenLabel.isEmpty()) lab = lab.isEmpty() ? whenLabel : lab + " · " + whenLabel;
                    rows.add(new Row(
                            id,
                            lab,
                            item.optString("title", ""),
                            item.optString("meta", ""),
                            timeText,
                            item.optString("phone", ""),
                            item.optBoolean("alarm", false),
                            item.optBoolean("hint", false),
                            item.optBoolean("fulfilled", false),
                            look
                    ));
                    shown += 1;
                    if (shown >= 80) break;
                }
            } catch (Exception ignored) {
                rows.clear();
            }
        }

        @Override
        public void onDestroy() {
            rows.clear();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            try {
                Row row = position >= 0 && position < rows.size() ? rows.get(position) : null;
                if (row == null) {
                    return new RemoteViews(context.getPackageName(), R.layout.widget_item);
                }
                RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_item);
                views.setTextViewText(R.id.widget_item_time, row.timeText == null ? "" : row.timeText);
                views.setTextViewText(R.id.widget_item_lab, row.lab);
                views.setViewVisibility(R.id.widget_item_lab,
                        row.lab == null || row.lab.isEmpty() ? View.GONE : View.VISIBLE);
                WidgetLook look = row.look != null ? row.look : WidgetLook.defaults();
                views.setTextColor(R.id.widget_item_lab, look.inkMuted);
                views.setTextColor(R.id.widget_item_meta, look.inkMuted);
                if (row.fulfilled) {
                    SpannableString struck = new SpannableString(row.title);
                    struck.setSpan(new StrikethroughSpan(), 0, struck.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    views.setTextViewText(R.id.widget_item_title, struck);
                    views.setTextColor(R.id.widget_item_title, look.inkMuted);
                    views.setTextColor(R.id.widget_item_time, look.inkMuted);
                } else {
                    views.setTextViewText(R.id.widget_item_title, row.title);
                    views.setTextColor(R.id.widget_item_title,
                            row.hint ? look.inkMuted : look.ink);
                    views.setTextColor(R.id.widget_item_time, look.accent);
                }
                views.setTextViewText(R.id.widget_item_meta, row.meta);
                views.setViewVisibility(R.id.widget_item_meta,
                        row.meta == null || row.meta.isEmpty() ? View.GONE : View.VISIBLE);

                int actions = row.hint ? View.GONE : View.VISIBLE;
                boolean hasPhone = row.phone != null && !row.phone.trim().isEmpty();
                views.setViewVisibility(R.id.widget_item_phone, actions == View.VISIBLE && hasPhone ? View.VISIBLE : View.GONE);
                views.setViewVisibility(R.id.widget_item_trash, actions);
                views.setViewVisibility(R.id.widget_item_alarm, actions);
                views.setViewVisibility(R.id.widget_item_edit, actions);
                if (row.hint) {
                    views.setViewVisibility(R.id.widget_item_time, View.GONE);
                } else {
                    views.setViewVisibility(R.id.widget_item_time, View.VISIBLE);
                }
                views.setImageViewResource(R.id.widget_item_alarm,
                        row.alarm ? R.drawable.ic_widget_alarm_on : R.drawable.ic_widget_alarm);
                look.applyRowIcons(context, views, row.alarm);
                views.setContentDescription(R.id.widget_item_alarm,
                        row.alarm ? "Будильник включён" : "Будильник выключен");
                views.setContentDescription(R.id.widget_item_phone, "Позвонить");
                views.setContentDescription(R.id.widget_item_edit, "Открыть запись");
                views.setContentDescription(R.id.widget_item_trash, "Удалить");
                views.setOnClickFillInIntent(R.id.widget_item_phone, fill("call", row.id, position));
                views.setOnClickFillInIntent(R.id.widget_item_trash, fill("trash", row.id, position));
                views.setOnClickFillInIntent(R.id.widget_item_alarm, fill("alarm", row.id, position));
                views.setOnClickFillInIntent(R.id.widget_item_edit, fill("edit", row.id, position));
                return views;
            } catch (Exception e) {
                return new RemoteViews(context.getPackageName(), R.layout.widget_item);
            }
        }

        private Intent fill(String action, String itemId, int position) {
            Intent intent = new Intent();
            intent.setData(Uri.parse("soulvoice://widget-row/" + action + "/" + itemId + "/" + position));
            intent.putExtra(SoulVoiceWidget.EXTRA_ACTION, action);
            intent.putExtra(SoulVoiceWidget.EXTRA_SHELF, "");
            intent.putExtra(SoulVoiceWidget.EXTRA_ITEM, itemId == null ? "" : itemId);
            return intent;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }

    static class Row {
        final String id;
        final String lab;
        final String title;
        final String meta;
        final String timeText;
        final String phone;
        final boolean alarm;
        final boolean hint;
        final boolean fulfilled;
        final WidgetLook look;

        Row(String id, String lab, String title, String meta, String timeText, String phone,
            boolean alarm, boolean hint, boolean fulfilled, WidgetLook look) {
            this.id = id;
            this.lab = lab;
            this.title = title;
            this.meta = meta;
            this.timeText = timeText;
            this.phone = phone;
            this.alarm = alarm;
            this.hint = hint;
            this.fulfilled = fulfilled;
            this.look = look;
        }
    }
}
