package ru.soulvoice.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Производитель устройства и экран настроек уведомлений приложения.
 */
@CapacitorPlugin(name = "PermissionsBridge")
public class PermissionsBridge extends Plugin {

    @PluginMethod
    public void getManufacturer(PluginCall call) {
        JSObject out = new JSObject();
        String mfr = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        out.put("manufacturer", mfr);
        call.resolve(out);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        String pkg = context.getPackageName();
        Intent intent = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        }
        if (intent == null || intent.resolveActivity(context.getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", pkg, null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve();
        } catch (Exception err) {
            call.reject("Не удалось открыть настройки уведомлений");
        }
    }
}
