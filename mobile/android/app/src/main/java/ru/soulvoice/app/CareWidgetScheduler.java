package ru.soulvoice.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Точный refresh виджета в момент косметики / витаминов,
 * чтобы сводка появилась без ожидания системного APPWIDGET_UPDATE.
 */
final class CareWidgetScheduler {
    private static final String ACTION = "ru.soulvoice.app.CARE_WIDGET_REFRESH";
    private static final int REQ_CARE_MORNING = 71001;
    private static final int REQ_CARE_EVENING = 71002;
    private static final int REQ_HEALTH_MORNING = 71003;
    private static final int REQ_HEALTH_MIDDAY = 71004;
    private static final int REQ_HEALTH_EVENING = 71005;

    private CareWidgetScheduler() {}

    static void schedule(Context context, JSONArray items) {
        if (context == null || items == null) return;
        Integer careMorningH = null, careMorningM = null;
        Integer careEveningH = null, careEveningM = null;
        Integer healthMorningH = null, healthMorningM = null;
        Integer healthMiddayH = null, healthMiddayM = null;
        Integer healthEveningH = null, healthEveningM = null;

        for (int i = 0; i < items.length(); i += 1) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            if (item.optBoolean("cancelled", false) || item.optBoolean("done", false)
                    || item.optBoolean("archived", false)) continue;
            JSONObject time = item.optJSONObject("time");
            if (time == null) continue;

            boolean care = "care".equals(item.optString("type", ""))
                    || "care".equals(item.optString("shelf", ""));
            boolean health = "health".equals(item.optString("type", ""))
                    || "health".equals(item.optString("shelf", ""));
            if (!care && !health) continue;

            if (care) {
                String part = item.optString("carePart", "");
                if (!"morning".equals(part) && !"evening".equals(part)) {
                    part = time.optInt("hour", 0) >= 15 ? "evening" : "morning";
                }
                if ("evening".equals(part)) {
                    if (careEveningH == null) {
                        careEveningH = time.optInt("hour", 21);
                        careEveningM = time.optInt("minute", 0);
                    }
                } else if (careMorningH == null) {
                    careMorningH = time.optInt("hour", 8);
                    careMorningM = time.optInt("minute", 0);
                }
                continue;
            }

            String part = item.optString("healthPart", "");
            if (!"morning".equals(part) && !"midday".equals(part) && !"evening".equals(part)) {
                int hour = time.optInt("hour", 8);
                part = hour >= 17 ? "evening" : hour >= 11 ? "midday" : "morning";
            }
            if ("evening".equals(part)) {
                if (healthEveningH == null) {
                    healthEveningH = time.optInt("hour", 21);
                    healthEveningM = time.optInt("minute", 0);
                }
            } else if ("midday".equals(part)) {
                if (healthMiddayH == null) {
                    healthMiddayH = time.optInt("hour", 13);
                    healthMiddayM = time.optInt("minute", 0);
                }
            } else if (healthMorningH == null) {
                healthMorningH = time.optInt("hour", 8);
                healthMorningM = time.optInt("minute", 0);
            }
        }

        schedulePart(context, REQ_CARE_MORNING, careMorningH, careMorningM);
        schedulePart(context, REQ_CARE_EVENING, careEveningH, careEveningM);
        schedulePart(context, REQ_HEALTH_MORNING, healthMorningH, healthMorningM);
        schedulePart(context, REQ_HEALTH_MIDDAY, healthMiddayH, healthMiddayM);
        schedulePart(context, REQ_HEALTH_EVENING, healthEveningH, healthEveningM);
    }

    private static void schedulePart(Context context, int reqCode, Integer hour, Integer minute) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, CareWidgetReceiver.class);
        intent.setAction(ACTION);
        PendingIntent cancelPi = PendingIntent.getBroadcast(
                context, reqCode, intent,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (cancelPi != null) {
            am.cancel(cancelPi);
            cancelPi.cancel();
        }
        if (hour == null) return;
        long at = nextShowAt(hour, minute == null ? 0 : minute);
        if (at <= System.currentTimeMillis() + 1500L) return;
        PendingIntent pi = PendingIntent.getBroadcast(
                context, reqCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            return;
        }
        am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
    }

    /** Момент назначенного времени сегодня, иначе завтра. */
    private static long nextShowAt(int hour, int minute) {
        Calendar due = Calendar.getInstance(TimeZone.getDefault());
        due.set(Calendar.SECOND, 0);
        due.set(Calendar.MILLISECOND, 0);
        due.set(Calendar.HOUR_OF_DAY, hour);
        due.set(Calendar.MINUTE, minute);
        long show = due.getTimeInMillis();
        if (show <= System.currentTimeMillis() + 1500L) {
            due.add(Calendar.DAY_OF_MONTH, 1);
            show = due.getTimeInMillis();
        }
        return show;
    }
}
