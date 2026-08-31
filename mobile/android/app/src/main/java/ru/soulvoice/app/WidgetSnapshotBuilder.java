package ru.soulvoice.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Единственный сборщик снимка виджета (как у типичных todo-виджетов):
 * сырые items + settings → JSON для SharedPreferences.
 * ListView только читает и фильтрует по activeTab — без второй семантики.
 */
final class WidgetSnapshotBuilder {
    static final int MAX_ITEMS = 80;

    private static final String[] MONTHS_GEN = {
            "января", "февраля", "марта", "апреля", "мая", "июня",
            "июля", "августа", "сентября", "октября", "ноября", "декабря"
    };
    private static final String[] MONTHS_SHORT = {
            "янв", "фев", "мар", "апр", "мая", "июн",
            "июл", "авг", "сен", "окт", "ноя", "дек"
    };

    private WidgetSnapshotBuilder() {}

    /** Полный снимок из ответа /api/state (или совместимого JSON). */
    static JSONObject fromServerState(JSONObject state) throws Exception {
        JSONObject user = state != null ? state.optJSONObject("user") : null;
        JSONObject settings = user != null ? user.optJSONObject("settings") : null;
        if (settings == null && state != null) settings = state.optJSONObject("settings");
        JSONArray src = state != null ? state.optJSONArray("items") : null;
        return build(src, settings);
    }

    static JSONObject build(JSONArray srcItems, JSONObject settings) throws Exception {
        Calendar todayCal = Calendar.getInstance(TimeZone.getDefault());
        int year = todayCal.get(Calendar.YEAR);
        int month = todayCal.get(Calendar.MONTH);
        int day = todayCal.get(Calendar.DAY_OF_MONTH);

        Calendar tomorrowCal = (Calendar) todayCal.clone();
        tomorrowCal.add(Calendar.DAY_OF_MONTH, 1);
        int ty = tomorrowCal.get(Calendar.YEAR);
        int tm = tomorrowCal.get(Calendar.MONTH);
        int td = tomorrowCal.get(Calendar.DAY_OF_MONTH);

        List<JSONObject> todayItems = collectDayItems(srcItems, year, month, day);
        List<JSONObject> tomorrowItems = collectDayItems(srcItems, ty, tm, td);

        JSONArray items = new JSONArray();
        if (todayItems.isEmpty()) {
            List<JSONObject> upcoming = collectUpcoming(srcItems, year, month, day, 3);
            if (!upcoming.isEmpty()) {
                items.put(freeDayHintRow("today"));
                for (int i = 0; i < upcoming.size(); i += 1) {
                    JSONObject src = upcoming.get(i);
                    JSONObject date = src.optJSONObject("date");
                    int uy = date != null ? date.optInt("year", year) : year;
                    int um = date != null ? date.optInt("month", month) : month;
                    int ud = date != null ? date.optInt("day", day) : day;
                    JSONObject row = toCalendarRow(src, i, "today", i == 0 ? "Дальше" : "", uy, um, ud);
                    row.put("timeText", formatTimeColumn(src));
                    row.put("whenLabel", relativeDayLabel(uy, um, ud, year, month, day));
                    items.put(row);
                }
            } else if (hasCalendarPool(srcItems)) {
                // Есть записи на другие полки/дни — день свободен, но приложение не пустое.
                items.put(freeDayHintRow("today"));
            }
            // Иначе полностью пусто: ListView empty view — «Скажите, что напомнить».
        } else {
            appendDayRows(items, todayItems, "today", "Сегодня", year, month, day);
        }
        appendDayRows(items, tomorrowItems, "tomorrow", "Завтра", ty, tm, td);

        JSONArray tabs = new JSONArray();
        tabs.put(dayTab("today", year, month, day));
        tabs.put(dayTab("tomorrow", ty, tm, td));

        String leftId = resolveSideButton(settings, "leftBtn", "shared");
        String rightId = resolveSideButton(settings, "rightBtn", "none");

        JSONObject snap = new JSONObject();
        snap.put("tabs", tabs);
        snap.put("leftBtn", buttonPayload(leftId));
        snap.put("rightBtn", buttonPayload(rightId));
        snap.put("shelfId", "none".equals(rightId) ? "" : rightId);
        snap.put("shelfLabel", "none".equals(rightId) ? "" : labelOf(rightId));
        snap.put("dayLabel", fmtDay(day, month));
        snap.put("monthLabel", "");
        snap.put("items", items);
        snap.put("builtAt", System.currentTimeMillis());
        snap.put("builder", "WidgetSnapshotBuilder");
        // Палитра: settings.widgetLook (если веб положил) — иначе дефолт stone.
        WidgetLook.mergeInto(snap, settings, null);
        return snap;
    }

    private static JSONObject dayTab(String id, int year, int month, int day) throws Exception {
        JSONObject tab = new JSONObject();
        tab.put("id", id);
        tab.put("label", fmtDay(day, month));
        tab.put("monthLabel", "");
        tab.put("year", year);
        tab.put("month", month);
        tab.put("day", day);
        return tab;
    }

    private static String fmtDay(int day, int month) {
        String mon = month >= 0 && month < MONTHS_GEN.length ? MONTHS_GEN[month] : "";
        return day + " " + mon;
    }

    private static List<JSONObject> collectDayItems(JSONArray srcItems, int year, int month, int day) {
        List<JSONObject> ordered = new ArrayList<>();
        if (srcItems == null) return ordered;
        Calendar now = Calendar.getInstance(TimeZone.getDefault());
        boolean isTodayBucket = year == now.get(Calendar.YEAR)
                && month == now.get(Calendar.MONTH)
                && day == now.get(Calendar.DAY_OF_MONTH);
        for (int i = 0; i < srcItems.length(); i += 1) {
            JSONObject item = srcItems.optJSONObject(i);
            if (item == null) continue;
            if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)
                    || item.optBoolean("archived", false)) continue;
            if (isDailyShelf(item)) continue;
            JSONObject date = item.optJSONObject("date");
            if (date == null) {
                if (!isTodayBucket) continue;
            } else if (date.optInt("year") != year || date.optInt("month") != month
                    || date.optInt("day") != day) {
                continue;
            }
            ordered.add(item);
        }
        sortByWhen(ordered);
        if (ordered.size() > MAX_ITEMS) {
            ordered = ordered.subList(0, MAX_ITEMS);
        }
        return ordered;
    }

    private static void appendDayRows(
            JSONArray items,
            List<JSONObject> ordered,
            String tabId,
            String lab,
            int year,
            int month,
            int day
    ) throws Exception {
        for (int i = 0; i < ordered.size(); i += 1) {
            JSONObject row = toCalendarRow(ordered.get(i), i, tabId, lab, year, month, day);
            row.put("timeText", formatTimeColumn(ordered.get(i)));
            items.put(row);
        }
    }

    /** Есть ли вообще активные записи (не только на сегодня). */
    private static boolean hasCalendarPool(JSONArray srcItems) {
        if (srcItems == null) return false;
        for (int i = 0; i < srcItems.length(); i += 1) {
            JSONObject item = srcItems.optJSONObject(i);
            if (item == null) continue;
            if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)
                    || item.optBoolean("archived", false)) continue;
            return true;
        }
        return false;
    }

    /** Ближайшие будущие записи после сегодня — чтобы виджет не пустел. */
    private static List<JSONObject> collectUpcoming(
            JSONArray srcItems, int year, int month, int day, int limit
    ) {
        List<JSONObject> ordered = new ArrayList<>();
        if (srcItems == null) return ordered;
        for (int i = 0; i < srcItems.length(); i += 1) {
            JSONObject item = srcItems.optJSONObject(i);
            if (item == null) continue;
            if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)
                    || item.optBoolean("archived", false)) continue;
            if (isDailyShelf(item)) continue;
            JSONObject date = item.optJSONObject("date");
            if (date == null) continue;
            int iy = date.optInt("year");
            int im = date.optInt("month");
            int id = date.optInt("day");
            if (iy < year) continue;
            if (iy == year && im < month) continue;
            if (iy == year && im == month && id <= day) continue;
            ordered.add(item);
        }
        sortByWhen(ordered);
        if (ordered.size() > limit) ordered = ordered.subList(0, limit);
        return ordered;
    }

    private static JSONObject freeDayHintRow(String tabId) throws Exception {
        JSONObject row = new JSONObject();
        row.put("id", "today-free");
        row.put("lab", "");
        row.put("title", "Сегодня свободно");
        row.put("meta", "");
        row.put("timeText", "");
        row.put("kind", "hint");
        row.put("shelf", "");
        row.put("alarm", false);
        row.put("hint", true);
        row.put("tabs", new JSONArray().put(tabId));
        return row;
    }

    private static String formatTimeColumn(JSONObject item) {
        JSONObject time = item != null ? item.optJSONObject("time") : null;
        if (time == null) return "—";
        return String.format(Locale.getDefault(), "%02d:%02d",
                time.optInt("hour", 0), time.optInt("minute", 0));
    }

    private static String relativeDayLabel(int y, int m, int d, int ty, int tm, int td) {
        Calendar target = Calendar.getInstance(TimeZone.getDefault());
        target.clear();
        target.set(y, m, d);
        Calendar today = Calendar.getInstance(TimeZone.getDefault());
        today.clear();
        today.set(ty, tm, td);
        long diff = (target.getTimeInMillis() - today.getTimeInMillis()) / 86400000L;
        if (diff == 1) return "завтра";
        if (diff == 2) return "послезавтра";
        return d + " " + (m >= 0 && m < MONTHS_SHORT.length ? MONTHS_SHORT[m] : "");
    }

    private static boolean isDailyShelf(JSONObject item) {
        if (item == null) return false;
        String shelf = shelfOf(item);
        String type = item.optString("type", "");
        return "care".equals(shelf) || "sport".equals(shelf) || "health".equals(shelf)
                || "alarms".equals(shelf) || "bday".equals(shelf) || "meters".equals(shelf)
                || "bills".equals(shelf) || "care".equals(type) || "sport".equals(type)
                || "health".equals(type) || "alarm".equals(type) || "bday".equals(type)
                || "bills".equals(type);
    }

    private static JSONObject toCalendarRow(
            JSONObject item,
            int index,
            String tabId,
            String lab,
            int year,
            int month,
            int day
    ) throws Exception {
        JSONObject row = toRow(item, index, Collections.singletonList(tabId));
        row.put("tabs", new JSONArray().put(tabId));
        boolean fulfilled = isCalendarFulfilled(item, year, month, day);
        String place = item.optString("place", "");
        String who = item.optString("who", "");
        StringBuilder meta = new StringBuilder();
        if (!place.isEmpty()) meta.append(place);
        if (!who.isEmpty()) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append(who);
        }
        if (fulfilled) {
            row.put("meta", meta.length() > 0 ? meta + " · исполнена" : "исполнена");
            row.put("fulfilled", true);
        } else {
            row.put("meta", meta.toString());
            row.put("fulfilled", false);
        }
        row.put("phone", item.optString("phone", ""));
        row.put("lab", index == 0 ? lab : "");
        row.put("timeText", formatTimeColumn(item));
        return row;
    }

    private static boolean isCalendarFulfilled(JSONObject item, int year, int month, int day) {
        if (item == null) return false;
        if (item.optBoolean("done", false)) return true;
        JSONObject time = item.optJSONObject("time");
        if (time == null) return false;
        Calendar now = Calendar.getInstance(TimeZone.getDefault());
        Calendar target = Calendar.getInstance(TimeZone.getDefault());
        target.set(year, month, day, 0, 0, 0);
        target.set(Calendar.MILLISECOND, 0);
        Calendar today = Calendar.getInstance(TimeZone.getDefault());
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);
        if (target.before(today)) return true;
        if (target.after(today)) return false;
        Calendar at = Calendar.getInstance(TimeZone.getDefault());
        at.set(year, month, day, time.optInt("hour", 0), time.optInt("minute", 0), 0);
        at.set(Calendar.MILLISECOND, 0);
        return at.getTimeInMillis() < now.getTimeInMillis();
    }

    static boolean matchesTab(JSONObject item, String tabId) {
        if (item == null || tabId == null || tabId.isEmpty()) return false;
        if ("today".equals(tabId) || "tomorrow".equals(tabId)) {
            JSONArray tabs = item.optJSONArray("tabs");
            if (tabs != null) {
                for (int i = 0; i < tabs.length(); i += 1) {
                    if (tabId.equals(tabs.optString(i))) return true;
                }
            }
            return false;
        }
        if (item.optBoolean("careSummary", false)) return "care".equals(tabId);
        if (item.optBoolean("healthSummary", false)) return "health".equals(tabId);
        if (isCare(item) || isHealth(item)) return false;
        if ("alarms".equals(tabId)) {
            return item.optBoolean("alarm", false)
                    || "alarm".equals(item.optString("type", ""))
                    || "alarms".equals(shelfOf(item));
        }
        if ("notes".equals(tabId)) return isNote(item);
        if ("meetings".equals(tabId)) {
            return "meeting".equals(item.optString("type", "")) || "meetings".equals(shelfOf(item));
        }
        if ("buy".equals(tabId)) {
            return "buy".equals(item.optString("type", "")) || "buy".equals(shelfOf(item));
        }
        return tabId.equals(shelfOf(item));
    }

    private static boolean isCare(JSONObject item) {
        return item != null && (
                "care".equals(item.optString("type", ""))
                        || "care".equals(item.optString("shelf", ""))
        );
    }

    private static boolean isHealth(JSONObject item) {
        return item != null && (
                "health".equals(item.optString("type", ""))
                        || "health".equals(item.optString("shelf", ""))
        );
    }

    private static String carePartOf(JSONObject item) {
        String part = item != null ? item.optString("carePart", "") : "";
        if ("morning".equals(part) || "evening".equals(part)) return part;
        JSONObject time = item != null ? item.optJSONObject("time") : null;
        if (time != null && time.optInt("hour", 0) >= 15) return "evening";
        return "morning";
    }

    private static String healthPartOf(JSONObject item) {
        String part = item != null ? item.optString("healthPart", "") : "";
        if ("morning".equals(part) || "midday".equals(part) || "evening".equals(part)) return part;
        JSONObject time = item != null ? item.optJSONObject("time") : null;
        if (time != null) {
            int hour = time.optInt("hour", 8);
            if (hour >= 17) return "evening";
            if (hour >= 11) return "midday";
        }
        return "morning";
    }

    private static boolean healthAppliesToday(JSONObject item) {
        JSONObject repeat = item != null ? item.optJSONObject("repeat") : null;
        if (repeat == null || !"weekly".equals(repeat.optString("kind", ""))) return true;
        JSONArray days = repeat.optJSONArray("days");
        if (days == null || days.length() == 0) return true;
        int weekday = Calendar.getInstance(TimeZone.getDefault()).get(Calendar.DAY_OF_WEEK) - 1; // 0=вс
        for (int i = 0; i < days.length(); i += 1) {
            if (days.optInt(i, -1) == weekday) return true;
        }
        return false;
    }

    private static List<JSONObject> careSummaries(JSONArray srcItems) throws Exception {
        List<JSONObject> morning = new ArrayList<>();
        List<JSONObject> evening = new ArrayList<>();
        if (srcItems != null) {
            for (int i = 0; i < srcItems.length(); i += 1) {
                JSONObject item = srcItems.optJSONObject(i);
                if (item == null) continue;
                if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)
                        || item.optBoolean("archived", false)) continue;
                if (!isCare(item)) continue;
                if ("evening".equals(carePartOf(item))) evening.add(item);
                else morning.add(item);
            }
        }
        List<JSONObject> out = new ArrayList<>();
        if (!morning.isEmpty()) {
            JSONObject row = careSummaryRow("morning", morning);
            if (row != null) out.add(row);
        }
        if (!evening.isEmpty()) {
            JSONObject row = careSummaryRow("evening", evening);
            if (row != null) out.add(row);
        }
        return out;
    }

    private static List<JSONObject> healthSummaries(JSONArray srcItems) throws Exception {
        List<JSONObject> morning = new ArrayList<>();
        List<JSONObject> midday = new ArrayList<>();
        List<JSONObject> evening = new ArrayList<>();
        if (srcItems != null) {
            for (int i = 0; i < srcItems.length(); i += 1) {
                JSONObject item = srcItems.optJSONObject(i);
                if (item == null) continue;
                if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)
                        || item.optBoolean("archived", false)) continue;
                if (!isHealth(item)) continue;
                if (!healthAppliesToday(item)) continue;
                String part = healthPartOf(item);
                if ("evening".equals(part)) evening.add(item);
                else if ("midday".equals(part)) midday.add(item);
                else morning.add(item);
            }
        }
        List<JSONObject> out = new ArrayList<>();
        if (!morning.isEmpty()) {
            JSONObject row = healthSummaryRow("morning", morning);
            if (row != null) out.add(row);
        }
        if (!midday.isEmpty()) {
            JSONObject row = healthSummaryRow("midday", midday);
            if (row != null) out.add(row);
        }
        if (!evening.isEmpty()) {
            JSONObject row = healthSummaryRow("evening", evening);
            if (row != null) out.add(row);
        }
        return out;
    }

    /** В виджете сводка видна с назначенного времени и до конца этого дня. */
    private static boolean careSummaryVisibleNow(JSONObject date, JSONObject time) {
        if (date == null || time == null) return false;
        Calendar due = Calendar.getInstance(TimeZone.getDefault());
        due.clear();
        due.set(
                date.optInt("year"),
                date.optInt("month"),
                date.optInt("day"),
                time.optInt("hour"),
                time.optInt("minute", 0),
                0
        );
        long dueMs = due.getTimeInMillis();
        Calendar end = (Calendar) due.clone();
        end.set(Calendar.HOUR_OF_DAY, 0);
        end.set(Calendar.MINUTE, 0);
        end.set(Calendar.SECOND, 0);
        end.set(Calendar.MILLISECOND, 0);
        end.add(Calendar.DAY_OF_MONTH, 1);
        long now = System.currentTimeMillis();
        return now >= dueMs - 30_000L && now < end.getTimeInMillis();
    }

    private static JSONObject careSummaryRow(String part, List<JSONObject> items) throws Exception {
        JSONObject time = null;
        for (JSONObject item : items) {
            JSONObject t = item.optJSONObject("time");
            if (t != null) {
                time = t;
                break;
            }
        }
        if (time == null) {
            time = new JSONObject();
            time.put("hour", "evening".equals(part) ? 21 : 8);
            time.put("minute", 0);
        }
        Calendar now = Calendar.getInstance(TimeZone.getDefault());
        JSONObject date = new JSONObject();
        date.put("year", now.get(Calendar.YEAR));
        date.put("month", now.get(Calendar.MONTH));
        date.put("day", now.get(Calendar.DAY_OF_MONTH));
        if (!careSummaryVisibleNow(date, time)) return null;
        JSONObject row = new JSONObject();
        row.put("id", "care-summary-" + part);
        row.put("careSummary", true);
        row.put("carePart", part);
        row.put("type", "care");
        row.put("shelf", "care");
        row.put("title", "evening".equals(part) ? "Вечер Косметика" : "Утро Косметика");
        row.put("date", date);
        row.put("time", new JSONObject(time.toString()));
        row.put("place", "");
        row.put("remind", 0);
        row.put("alarm", false);
        return row;
    }

    private static JSONObject healthSummaryRow(String part, List<JSONObject> items) throws Exception {
        JSONObject time = null;
        for (JSONObject item : items) {
            JSONObject t = item.optJSONObject("time");
            if (t != null) {
                time = t;
                break;
            }
        }
        if (time == null) {
            time = new JSONObject();
            int hour = "evening".equals(part) ? 21 : "midday".equals(part) ? 13 : 8;
            time.put("hour", hour);
            time.put("minute", 0);
        }
        Calendar now = Calendar.getInstance(TimeZone.getDefault());
        JSONObject date = new JSONObject();
        date.put("year", now.get(Calendar.YEAR));
        date.put("month", now.get(Calendar.MONTH));
        date.put("day", now.get(Calendar.DAY_OF_MONTH));
        if (!careSummaryVisibleNow(date, time)) return null;
        String title = "evening".equals(part) ? "Вечер Витамины"
                : "midday".equals(part) ? "День Витамины"
                : "Утро Витамины";
        JSONObject row = new JSONObject();
        row.put("id", "health-summary-" + part);
        row.put("healthSummary", true);
        row.put("healthPart", part);
        row.put("type", "health");
        row.put("shelf", "health");
        row.put("title", title);
        row.put("date", date);
        row.put("time", new JSONObject(time.toString()));
        row.put("place", "");
        row.put("remind", 0);
        row.put("alarm", false);
        return row;
    }

    static boolean isNote(JSONObject item) {
        return item != null && (
                "note".equals(item.optString("type", ""))
                        || "notes".equals(item.optString("shelf", ""))
        );
    }

    static int countReal(JSONObject snap) {
        if (snap == null) return 0;
        JSONArray items = snap.optJSONArray("items");
        if (items == null) return 0;
        int n = 0;
        for (int i = 0; i < items.length(); i += 1) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || item.optString("id", "").isEmpty()) continue;
            if (item.optBoolean("hint", false)) continue;
            n += 1;
        }
        return n;
    }

    static int countNotes(JSONObject snap) {
        if (snap == null) return 0;
        JSONArray items = snap.optJSONArray("items");
        if (items == null) return 0;
        int n = 0;
        for (int i = 0; i < items.length(); i += 1) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || item.optString("id", "").isEmpty()) continue;
            if (isNote(item) || "notes".equals(item.optString("shelf", ""))) n += 1;
            else {
                JSONArray tabs = item.optJSONArray("tabs");
                if (tabs != null) {
                    for (int t = 0; t < tabs.length(); t += 1) {
                        if ("notes".equals(tabs.optString(t))) {
                            n += 1;
                            break;
                        }
                    }
                }
            }
        }
        return n;
    }

    /**
     * Можно ли заменить кэш.
     * Пустышка без нашего сборщика не затирает живые данные (сбой sync).
     * Пустой снимок WidgetSnapshotBuilder — можно: удалили последнюю запись с виджета.
     */
    static boolean shouldReplace(String oldRaw, String newRaw) {
        JSONObject oldSnap = parse(oldRaw);
        JSONObject newSnap = parse(newRaw);
        int oldReal = countReal(oldSnap);
        int newReal = countReal(newSnap);
        String builder = newSnap != null ? newSnap.optString("builder", "") : "";
        boolean ours = "WidgetSnapshotBuilder".equals(builder);
        // Актуальный сборщик — источник истины, в том числе пустой список после удаления.
        if (ours) return true;
        // Чужой/битый пустой ответ не затирает живые строки.
        if (oldReal > 0 && newReal == 0) return false;
        int oldNotes = countNotes(oldSnap);
        int newNotes = countNotes(newSnap);
        if (oldNotes > 0 && newNotes == 0 && newReal > 0 && newReal <= oldReal) {
            return false;
        }
        return true;
    }

    private static JSONObject parse(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<String> resolveTabIds(JSONObject settings) {
        List<String> tabs = new ArrayList<>();
        tabs.add("today");
        tabs.add("tomorrow");
        return tabs;
    }

    /** Боковая кнопка виджета из settings.widgetConfig (зеркало app.js widgetConfig). */
    private static String resolveSideButton(JSONObject settings, String key, String defaultId) {
        JSONObject cfg = settings != null ? settings.optJSONObject("widgetConfig") : null;
        String id = cfg != null ? cfg.optString(key, "") : "";
        if (id.isEmpty() && "rightBtn".equals(key) && settings != null) {
            id = settings.optString("widgetShortcut", "");
        }
        if (id.isEmpty()) id = defaultId;
        if ("none".equals(id)) return "none";
        if ("today".equals(id) || "templates".equals(id)) return defaultId;
        return id;
    }

    private static boolean matchesAnyTab(JSONObject item, List<String> tabIds) {
        for (String tab : tabIds) {
            if (matchesTab(item, tab)) return true;
        }
        return false;
    }

    private static JSONObject toRow(JSONObject item, int index, List<String> tabIds) throws Exception {
        JSONObject row = new JSONObject();
        row.put("id", item.optString("id", ""));
        row.put("lab", index == 0 ? "Дальше" : "Следом");
        row.put("title", item.optString("title", ""));
        row.put("meta", formatWhen(item)
                + (item.optString("place", "").isEmpty() ? "" : " · " + item.optString("place")));
        row.put("kind", item.optString("type", ""));
        row.put("shelf", shelfOf(item));
        row.put("alarm", item.optBoolean("alarm", false));
        row.put("timer", item.optBoolean("timer", false));
        JSONObject date = item.optJSONObject("date");
        if (date != null) row.put("date", new JSONObject(date.toString()));
        JSONObject time = item.optJSONObject("time");
        if (time != null) row.put("time", new JSONObject(time.toString()));
        row.put("remind", item.optInt("remind", 0));
        JSONArray tabs = new JSONArray();
        for (String tab : tabIds) {
            if (matchesTab(item, tab)) tabs.put(tab);
        }
        if (tabs.length() == 0 && !tabIds.isEmpty()) tabs.put(tabIds.get(0));
        row.put("tabs", tabs);
        return row;
    }

    private static JSONObject emptyRow(List<String> tabIds) throws Exception {
        JSONObject empty = new JSONObject();
        empty.put("id", "");
        empty.put("lab", "");
        empty.put("title", "Скажите, что напомнить");
        empty.put("meta", "");
        empty.put("timeText", "");
        empty.put("kind", "");
        empty.put("shelf", "");
        empty.put("alarm", false);
        JSONArray tabs = new JSONArray();
        for (String tab : tabIds) tabs.put(tab);
        empty.put("tabs", tabs);
        return empty;
    }

    private static JSONArray tabsPayload(List<String> tabIds) throws Exception {
        JSONArray tabs = new JSONArray();
        for (String id : tabIds) {
            JSONObject t = new JSONObject();
            t.put("id", id);
            t.put("label", labelOf(id));
            tabs.put(t);
        }
        return tabs;
    }

    private static JSONObject buttonPayload(String id) throws Exception {
        JSONObject b = new JSONObject();
        if (id == null || id.isEmpty() || "none".equals(id)) {
            b.put("id", "");
            b.put("label", "");
            return b;
        }
        b.put("id", id);
        b.put("label", labelOf(id));
        return b;
    }

    private static String labelOf(String id) {
        if (id == null) return "";
        switch (id) {
            case "daily": return "Ежедневные";
            case "shelves": return "Календарь";
            case "today": return "Дела";
            case "notes": return "Заметки";
            case "buy": return "Покупки";
            case "care": return "Косметика";
            case "sport": return "Спорт";
            case "meetings": return "Встречи";
            case "tasks": return "Дела";
            case "alarms": return "Будильник";
            case "bills": return "Оплаты";
            case "meters": return "Счетчики и ЖКХ";
            case "health": return "Витамины";
            case "bday": return "Дни рождения";
            case "shared": return "Общие списки";
            default: return id;
        }
    }

    private static String shelfOf(JSONObject item) {
        String shelf = item.optString("shelf", "");
        if (!shelf.isEmpty()) return shelf;
        String type = item.optString("type", "");
        if ("note".equals(type)) return "notes";
        if ("alarm".equals(type)) return "alarms";
        if ("meeting".equals(type)) return "meetings";
        if ("buy".equals(type)) return "buy";
        if ("care".equals(type)) return "care";
        return "tasks";
    }

    private static boolean isTodayOrOverdue(JSONObject item) {
        JSONObject date = item.optJSONObject("date");
        if (date == null) return true;
        Calendar now = Calendar.getInstance(TimeZone.getDefault());
        int y = date.optInt("year", -1);
        int m = date.optInt("month", -1);
        int d = date.optInt("day", -1);
        if (y < 0 || m < 0 || d < 0) return true;
        Calendar due = Calendar.getInstance(TimeZone.getDefault());
        due.clear();
        due.set(y, m, d);
        Calendar today = Calendar.getInstance(TimeZone.getDefault());
        today.clear();
        today.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH));
        return !due.after(today);
    }

    private static void sortByWhen(List<JSONObject> list) {
        Collections.sort(list, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                long sa = stamp(a);
                long sb = stamp(b);
                return Long.compare(sa, sb);
            }
        });
    }

    private static long stamp(JSONObject item) {
        JSONObject date = item.optJSONObject("date");
        if (date == null) return Long.MAX_VALUE / 4;
        JSONObject time = item.optJSONObject("time");
        Calendar c = Calendar.getInstance(TimeZone.getDefault());
        c.clear();
        c.set(
                date.optInt("year"),
                date.optInt("month"),
                date.optInt("day"),
                time != null ? time.optInt("hour") : 0,
                time != null ? time.optInt("minute") : 0
        );
        return c.getTimeInMillis();
    }

    private static String formatWhen(JSONObject item) {
        JSONObject date = item.optJSONObject("date");
        if (date == null) return "без срока";
        Calendar now = Calendar.getInstance(TimeZone.getDefault());
        int y = date.optInt("year");
        int m = date.optInt("month");
        int d = date.optInt("day");
        String dayLabel;
        if (y == now.get(Calendar.YEAR) && m == now.get(Calendar.MONTH) && d == now.get(Calendar.DAY_OF_MONTH)) {
            dayLabel = "сегодня";
        } else {
            Calendar tom = (Calendar) now.clone();
            tom.add(Calendar.DAY_OF_MONTH, 1);
            if (y == tom.get(Calendar.YEAR) && m == tom.get(Calendar.MONTH) && d == tom.get(Calendar.DAY_OF_MONTH)) {
                dayLabel = "завтра";
            } else {
                dayLabel = d + " " + (m >= 0 && m < MONTHS_SHORT.length ? MONTHS_SHORT[m] : "");
            }
        }
        JSONObject time = item.optJSONObject("time");
        if (time == null) return dayLabel + " · без времени";
        return String.format(Locale.getDefault(), "%s · %02d:%02d",
                dayLabel, time.optInt("hour"), time.optInt("minute"));
    }
}
