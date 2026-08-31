package ru.soulvoice.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * После установки обновления поверх текущей версии — сразу восстановить виджет
 * из сервера по сохранённому токену, не дожидаясь открытия приложения.
 */
public class PackageReplacedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                WidgetSync.refreshFromServer(context.getApplicationContext());
            } finally {
                pending.finish();
            }
        }, "widget-after-update").start();
    }
}
