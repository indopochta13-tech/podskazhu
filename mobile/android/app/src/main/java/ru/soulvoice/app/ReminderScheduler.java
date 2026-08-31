package ru.soulvoice.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/** Точные будильники с виджета — те же id, что у Capacitor syncReminders в native.js. */
final class ReminderScheduler {
    private static final long MIN_LEAD_MS = 1000L;

    private ReminderScheduler() {}

    static int idFor(String itemId, int slot) {
        int hash = (int) 2166136261L;
        for (int i = 0; i < itemId.length(); i += 1) {
            hash ^= itemId.charAt(i);
            hash *= 16777619;
        }
        return ((hash >>> 2) % 400000000) * 4 + slot;
    }

    static void scheduleItems(Context context, JSONArray items) {
        if (items == null) return;
        for (int i = 0; i < items.length(); i += 1) {
            JSONObject item = items.optJSONObject(i);
            if (item != null) scheduleItem(context, item);
        }
    }

    static void scheduleItem(Context context, JSONObject item) {
        if (item == null) return;
        String itemId = item.optString("id", "");
        if (itemId.isEmpty()) return;
        cancelItem(context, itemId);
        if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)) return;
        if ("pending".equals(item.optString("status", "active"))) return;
        if (!item.optBoolean("enabled", true)) return;

        Long atMs = eventMillis(item);
        if (atMs == null) return;
        long now = System.currentTimeMillis();
        String shelf = item.optString("shelf", "");
        String type = item.optString("type", "");
        if ("health".equals(shelf) || "health".equals(type)) {
            Calendar cal = Calendar.getInstance(TimeZone.getDefault());
            cal.setTimeInMillis(atMs);
            if (healthDayOff(context, cal.get(Calendar.DAY_OF_WEEK) - 1)) return;
        }
        // Уход / витамины — в момент времени на полке, без «за час» из старых сидов.
        boolean routineAtEvent = "health".equals(shelf) || "care".equals(shelf)
                || "health".equals(type) || "care".equals(type);
        int remind = routineAtEvent ? 0 : Math.max(0, item.optInt("remind", 0));
        long remindAt = atMs - remind * 60000L;

        if (item.optBoolean("push", true) && remindAt > now + MIN_LEAD_MS) {
            boolean sameMoment = item.optBoolean("alarm", false) && remind == 0;
            if (!sameMoment) {
                scheduleAt(context, itemId, item, remindAt, 0, false, aheadText(remind));
            }
        }
        if (item.optBoolean("alarm", false) && atMs > now + MIN_LEAD_MS) {
            scheduleAt(context, itemId, item, atMs, 1, true, "");
        }
    }

    static void cancelItem(Context context, String itemId) {
        if (itemId == null || itemId.isEmpty()) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        for (int slot = 0; slot <= 1; slot += 1) {
            PendingIntent pi = alarmIntent(context, itemId, slot, null, false, false, "");
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }
    }

    private static void scheduleAt(Context context, String itemId, JSONObject item, long atMs, int slot,
                                   boolean alarm, String ahead) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(context, itemId, slot, item, true, alarm, ahead);
        if (pi == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
            return;
        }
        am.setExact(AlarmManager.RTC_WAKEUP, atMs, pi);
    }

    private static PendingIntent alarmIntent(Context context, String itemId, int slot, JSONObject item,
                                             boolean create, boolean alarm, String ahead) {
        Intent intent = new Intent(context, ReminderAlarmReceiver.class);
        intent.setAction("ru.soulvoice.app.REMINDER_ALARM");
        intent.putExtra("itemId", itemId);
        intent.putExtra("slot", slot);
        intent.putExtra("alarm", alarm);
        if (item != null) {
            intent.putExtra("title", notifyDisplayTitle(item));
            intent.putExtra("body", buildBody(item, alarm, ahead));
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        if (!create) flags |= PendingIntent.FLAG_NO_CREATE;
        return PendingIntent.getBroadcast(context, idFor(itemId, slot), intent, flags);
    }

    private static String notifyDisplayTitle(JSONObject item) {
        if (item == null) return "SoulVoice";
        String type = item.optString("type", "");
        String shelf = item.optString("shelf", "");
        if ("health".equals(type) || "health".equals(shelf)) {
            String part = item.optString("healthPart", "");
            if (!"morning".equals(part) && !"midday".equals(part) && !"evening".equals(part)) {
                JSONObject time = item.optJSONObject("time");
                int hour = time != null ? time.optInt("hour", 8) : 8;
                part = hour >= 17 ? "evening" : hour >= 11 ? "midday" : "morning";
            }
            if ("evening".equals(part)) return "Вечер Витамины";
            if ("midday".equals(part)) return "День Витамины";
            return "Утро Витамины";
        }
        if ("care".equals(type) || "care".equals(shelf)) {
            String part = item.optString("carePart", "");
            if (!"morning".equals(part) && !"evening".equals(part)) {
                JSONObject time = item.optJSONObject("time");
                part = time != null && time.optInt("hour", 0) >= 15 ? "evening" : "morning";
            }
            return "evening".equals(part) ? "Вечер Косметика" : "Утро Косметика";
        }
        String title = item.optString("title", "");
        return title.isEmpty() ? "SoulVoice" : title;
    }

    private static String buildBody(JSONObject item, boolean alarm, String ahead) {
        String when = formatWhen(item);
        String place = item.optString("place", "");
        if (!place.isEmpty()) place = " · " + place;
        else place = "";
        if (alarm) return when + place;
        return (ahead.isEmpty() ? "" : ahead + " · ") + when + place;
    }

    private static String aheadText(int minutes) {
        if (minutes <= 0) return "";
        if (minutes >= 1440) return String.format(Locale.getDefault(), "за %d дн", Math.round(minutes / 1440f));
        if (minutes >= 60) return String.format(Locale.getDefault(), "за %d ч", Math.round(minutes / 60f));
        return String.format(Locale.getDefault(), "за %d мин", minutes);
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
                dayLabel = d + "." + (m + 1);
            }
        }
        JSONObject time = item.optJSONObject("time");
        if (time == null) return dayLabel + " · без времени";
        return String.format(Locale.getDefault(), "%s · %02d:%02d",
                dayLabel, time.optInt("hour"), time.optInt("minute"));
    }

    static Long eventMillis(JSONObject item) {
        JSONObject date = item.optJSONObject("date");
        JSONObject time = item.optJSONObject("time");
        if (date == null || time == null) return null;
        Calendar cal = Calendar.getInstance(TimeZone.getDefault());
        cal.set(Calendar.YEAR, date.optInt("year"));
        cal.set(Calendar.MONTH, date.optInt("month"));
        cal.set(Calendar.DAY_OF_MONTH, date.optInt("day"));
        cal.set(Calendar.HOUR_OF_DAY, time.optInt("hour"));
        cal.set(Calendar.MINUTE, time.optInt("minute"));
        // Таймеры хранят секунды; иначе «через минуту» в :30 срабатывает на :00 следующей минуты.
        cal.set(Calendar.SECOND, time.optInt("second", 0));
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    /** JS weekday 0=вс … 6=сб — выключенные дни в «Витамины». */
    private static boolean healthDayOff(Context context, int weekday) {
        if (weekday < 0 || weekday > 6) return false;
        SharedPreferences prefs = context.getSharedPreferences(SoulVoiceWidget.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(SoulVoiceWidget.KEY_STATE_SETTINGS, "");
        if (raw == null || raw.isEmpty()) return false;
        try {
            JSONArray off = new JSONObject(raw).optJSONArray("healthDaysOff");
            if (off == null) return false;
            for (int i = 0; i < off.length(); i += 1) {
                if (off.optInt(i, -1) == weekday) return true;
            }
        } catch (Exception ignored) {
            // Битые настройки не должны ломать расписание.
        }
        return false;
    }
}
