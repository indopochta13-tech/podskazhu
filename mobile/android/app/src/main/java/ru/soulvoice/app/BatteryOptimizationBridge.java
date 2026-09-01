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
 * Сначала системный диалог «не оптимизировать», иначе список исключений.
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
        String pkg = context.getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent request = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                request.setData(Uri.parse("package:" + pkg));
                request.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (request.resolveActivity(context.getPackageManager()) != null) {
                    context.startActivity(request);
                    call.resolve();
                    return;
                }
            } catch (Exception ignored) {
            }
            try {
                Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (list.resolveActivity(context.getPackageManager()) != null) {
                    context.startActivity(list);
                    call.resolve();
                    return;
                }
            } catch (Exception ignored) {
            }
        }
        Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        fallback.setData(Uri.fromParts("package", pkg, null));
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(fallback);
            call.resolve();
        } catch (Exception err) {
            call.reject("Не удалось открыть настройки");
        }
    }
}
