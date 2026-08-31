package ru.soulvoice.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/** Срабатывание AlarmManager с виджета — тот же id, что у Capacitor LocalNotifications. */
public class ReminderAlarmReceiver extends BroadcastReceiver {
    private static final String CHANNEL_REMIND = "reminders_notify_soft";
    private static final String CHANNEL_ALARM = "alarms_alarm_sunrise";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String itemId = intent.getStringExtra("itemId");
        if (itemId == null || itemId.isEmpty()) return;
        int slot = intent.getIntExtra("slot", 1);
        boolean alarm = intent.getBooleanExtra("alarm", slot == 1);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        if (title == null || title.isEmpty()) title = alarm ? "SoulVoice" : "Напоминание";
        if (body == null) body = "";
        if (alarm && !title.startsWith("Сейчас:")) title = "Сейчас: " + title;

        ensureChannels(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(SoulVoiceWidget.EXTRA_ITEM, itemId);
        PendingIntent content = PendingIntent.getActivity(context, ReminderScheduler.idFor(itemId, slot),
                open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String channel = alarm ? CHANNEL_ALARM : CHANNEL_REMIND;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_widget_alarm_on)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(content)
                .setAutoCancel(true)
                .setPriority(alarm ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
                .setCategory(alarm ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER);
        if (alarm) builder.setVibrate(new long[] { 0, 450, 200, 450 });

        nm.notify(ReminderScheduler.idFor(itemId, slot), builder.build());
    }

    private static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel remind = new NotificationChannel(
                CHANNEL_REMIND, "Напоминания", NotificationManager.IMPORTANCE_HIGH);
        remind.setDescription("Заранее о встречах и делах");
        remind.enableVibration(true);
        remind.setSound(uriRaw(context, R.raw.notify_soft), attrs);
        nm.createNotificationChannel(remind);

        NotificationChannel alarm = new NotificationChannel(
                CHANNEL_ALARM, "Будильник", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Громкий сигнал в момент события");
        alarm.enableVibration(true);
        alarm.setBypassDnd(true);
        alarm.setSound(uriRaw(context, R.raw.alarm_sunrise), attrs);
        nm.createNotificationChannel(alarm);
    }

    private static Uri uriRaw(Context context, int rawId) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + rawId);
    }
}
