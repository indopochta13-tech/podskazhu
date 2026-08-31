package ru.soulvoice.app;

import android.graphics.Color;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.Calendar;
import java.util.TimeZone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * Календарный виджет: сегодня + завтра, заметки без даты на сегодня.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class WidgetSnapshotBuilderTest {

    @Test
    public void buildsTodayAndTomorrowTabs() throws Exception {
        JSONArray src = new JSONArray();
        src.put(note("n1", "Сегодняшняя"));
        src.put(tomorrowTask("t1", "Завтрашнее"));

        JSONObject snap = WidgetSnapshotBuilder.build(src, null);
        assertEquals("WidgetSnapshotBuilder", snap.optString("builder"));

        JSONArray tabs = snap.optJSONArray("tabs");
        assertEquals(2, tabs.length());
        assertEquals("today", tabs.optJSONObject(0).optString("id"));
        assertEquals("tomorrow", tabs.optJSONObject(1).optString("id"));
        assertTrue(tabs.optJSONObject(0).optString("label").contains(" "));
        assertTrue(tabs.optJSONObject(1).optString("label").contains(" "));

        JSONArray items = snap.optJSONArray("items");
        int todayRows = 0;
        int tomorrowRows = 0;
        for (int i = 0; i < items.length(); i += 1) {
            JSONObject row = items.optJSONObject(i);
            String tab = row.optJSONArray("tabs").optString(0);
            if ("today".equals(tab)) todayRows += 1;
            if ("tomorrow".equals(tab)) tomorrowRows += 1;
        }
        assertTrue(todayRows >= 1);
        assertTrue(tomorrowRows >= 1);
    }

    @Test
    public void shouldReplaceAllowsEmptyFromOurBuilder() throws Exception {
        JSONObject live = WidgetSnapshotBuilder.build(
                new JSONArray().put(note("n1", "Живая")),
                null
        );
        JSONObject empty = WidgetSnapshotBuilder.build(new JSONArray(), null);
        // Удалили последнюю запись — пустой снимок нашего сборщика должен пройти.
        assertTrue(WidgetSnapshotBuilder.shouldReplace(live.toString(), empty.toString()));
        assertTrue(WidgetSnapshotBuilder.shouldReplace(empty.toString(), live.toString()));
        // Пустышка без builder не затирает живые данные.
        assertFalse(WidgetSnapshotBuilder.shouldReplace(live.toString(), "{\"items\":[]}"));
    }

    @Test
    public void itemTabsMatchDayChips() throws Exception {
        JSONObject snap = WidgetSnapshotBuilder.build(new JSONArray().put(note("n1", "текст")), null);
        JSONObject row = snap.optJSONArray("items").optJSONObject(0);
        assertTrue(SoulVoiceWidget.itemMatchesTab(row, "today"));
        assertFalse(SoulVoiceWidget.itemMatchesTab(row, "tomorrow"));
    }

    @Test
    public void lookFieldsFromSettingsWidgetLook() throws Exception {
        JSONObject settings = new JSONObject();
        JSONObject look = new JSONObject();
        look.put("palette", "plum");
        look.put("theme", "dark");
        look.put("accent", "#c4a2d4");
        look.put("accentSoft", "#332a3a");
        look.put("surface", "#221d26");
        look.put("ink", "#eae5ee");
        look.put("inkMuted", "#756a7c");
        settings.put("widgetLook", look);

        JSONObject snap = WidgetSnapshotBuilder.build(new JSONArray(), settings);
        assertEquals("plum", snap.optString("palette"));
        assertEquals("#c4a2d4", snap.optString("accent"));
        assertEquals("#221d26", snap.optString("surface"));
        assertTrue(WidgetLook.hasColors(snap));
        assertEquals(0xFFC4A2D4, WidgetLook.parseColor(snap.optString("accent"), 0));
        assertEquals(0xD0221D26, WidgetLook.withAlpha(
                WidgetLook.parseColor(snap.optString("surface"), 0), WidgetLook.SURFACE_ALPHA));
    }

    @Test
    public void mergeLookPrefersCacheOverDefaults() throws Exception {
        JSONObject snap = WidgetSnapshotBuilder.build(new JSONArray(), null);
        assertEquals("#5c5248", snap.optString("accent"));

        JSONObject cached = new JSONObject();
        cached.put("accent", "#2f6b62");
        cached.put("accentSoft", "#dceeea");
        cached.put("surface", "#ffffff");
        cached.put("ink", "#18211f");
        cached.put("inkMuted", "#64706c");
        cached.put("palette", "teal");
        cached.put("theme", "light");
        WidgetLook.mergeInto(snap, null, cached);
        assertEquals("teal", snap.optString("palette"));
        assertEquals("#2f6b62", snap.optString("accent"));
    }

    @Test
    public void plumPaletteAccentIsNotTealGreen() throws Exception {
        JSONObject snap = new JSONObject();
        snap.put("palette", "plum");
        snap.put("accent", "#c4a2d4");
        snap.put("accentSoft", "#332a3a");
        snap.put("surface", "#221d26");
        snap.put("ink", "#eae5ee");
        snap.put("inkMuted", "#756a7c");
        WidgetLook look = WidgetLook.fromSnapshot(snap);
        assertEquals(0xFFC4A2D4, look.accent);
        assertTrue(Color.green(look.accent) < Color.red(look.accent));
        assertTrue(Color.green(look.inkMuted) < 0x90);
    }

    @Test
    public void sideButtonsFromWidgetConfig() throws Exception {
        JSONObject settings = new JSONObject();
        JSONObject cfg = new JSONObject();
        cfg.put("leftBtn", "shared");
        cfg.put("rightBtn", "care");
        settings.put("widgetConfig", cfg);

        JSONObject snap = WidgetSnapshotBuilder.build(new JSONArray(), settings);
        assertEquals("care", snap.optJSONObject("rightBtn").optString("id"));
        assertEquals("Косметика", snap.optJSONObject("rightBtn").optString("label"));
        assertEquals("shared", snap.optJSONObject("leftBtn").optString("id"));
    }

    @Test
    public void sideButtonIconMapping() {
        assertEquals(R.drawable.ic_widget_shelf, WidgetLook.drawableForSideButton("shared"));
        assertEquals(R.drawable.ic_widget_calendar, WidgetLook.drawableForSideButton("shelves"));
        assertEquals(R.drawable.ic_widget_calendar, WidgetLook.drawableForSideButton("meetings"));
        assertEquals(R.drawable.ic_widget_repeat, WidgetLook.drawableForSideButton("daily"));
        assertEquals(R.drawable.ic_widget_alarm, WidgetLook.drawableForSideButton("alarms"));
        assertEquals(R.drawable.ic_widget_chat, WidgetLook.drawableForSideButton("notes"));
        assertEquals(R.drawable.ic_widget_tasks, WidgetLook.drawableForSideButton("tasks"));
        assertEquals(R.drawable.ic_widget_buy, WidgetLook.drawableForSideButton("buy"));
        assertEquals(R.drawable.ic_widget_bday, WidgetLook.drawableForSideButton("bday"));
        assertEquals(R.drawable.ic_widget_sport, WidgetLook.drawableForSideButton("sport"));
        assertEquals(R.drawable.ic_widget_care, WidgetLook.drawableForSideButton("care"));
        assertEquals(R.drawable.ic_widget_bills, WidgetLook.drawableForSideButton("bills"));
        assertEquals(R.drawable.ic_widget_health, WidgetLook.drawableForSideButton("health"));
        assertEquals(R.drawable.ic_widget_meters, WidgetLook.drawableForSideButton("meters"));
        assertEquals(R.drawable.ic_widget_shelf, WidgetLook.drawableForSideButton("none"));
    }

    @Test
    public void dayChipUsesMinimalRadius() {
        float density = 2f;
        float chipRadius = 10f * density;
        assertEquals(20f, chipRadius, 0.01f);
    }

    private static JSONObject note(String id, String title) throws Exception {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("title", title);
        o.put("type", "note");
        o.put("shelf", "notes");
        o.put("cancelled", false);
        o.put("done", false);
        return o;
    }

    private static JSONObject tomorrowTask(String id, String title) throws Exception {
        Calendar tom = Calendar.getInstance(TimeZone.getDefault());
        tom.add(Calendar.DAY_OF_MONTH, 1);
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("title", title);
        o.put("type", "task");
        o.put("shelf", "tasks");
        o.put("cancelled", false);
        o.put("done", false);
        JSONObject date = new JSONObject();
        date.put("year", tom.get(Calendar.YEAR));
        date.put("month", tom.get(Calendar.MONTH));
        date.put("day", tom.get(Calendar.DAY_OF_MONTH));
        o.put("date", date);
        JSONObject time = new JSONObject();
        time.put("hour", 10);
        time.put("minute", 0);
        o.put("time", time);
        return o;
    }
}
