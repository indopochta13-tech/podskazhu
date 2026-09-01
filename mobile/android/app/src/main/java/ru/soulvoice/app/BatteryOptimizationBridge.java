package ru.soulvoice.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Оптимизация батареи: проверка и переход в системные настройки.
 * Без REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — только экран настроек, как просят магазины.
 */
@CapacitorPlugin(name = "BatteryOptimizationBridge")
public class BatteryOptimizationBridge extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            out.put("ignored", true);
            call.resolve(out);
            return;
        }
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        boolean ignored = pm != null
                && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        out.put("ignored", ignored);
        call.resolve(out);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            if (intent.resolveActivity(context.getPackageManager()) == null) {
                intent = null;
            }
        }
        if (intent == null) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", context.getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve();
        } catch (Exception err) {
            call.reject("Не удалось открыть настройки");
        }
    }
}
