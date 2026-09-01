package ru.soulvoice.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Версия установленного APK (для отображения в настройках).
 * Самообновление убрано — обновления только через RuStore или ссылку на сайте.
 */
@CapacitorPlugin(name = "UpdateBridge")
public class UpdateBridge extends Plugin {

    @PluginMethod
    public void version(PluginCall call) {
        JSObject out = new JSObject();
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            out.put("versionName", info.versionName != null ? info.versionName : "");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                out.put("versionCode", info.getLongVersionCode());
            } else {
                out.put("versionCode", info.versionCode);
            }
        } catch (PackageManager.NameNotFoundException err) {
            out.put("versionName", "");
            out.put("versionCode", 0);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            out.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            out.put("allowed", true);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Нет адреса файла");
            return;
        }

        new Thread(() -> {
            try {
                File apk = downloadApk(url);
                getActivity().runOnUiThread(() -> startInstall(apk, call));
            } catch (Exception err) {
                call.reject(err.getMessage() != null ? err.getMessage() : "Не удалось скачать");
            }
        }).start();
    }

    private File downloadApk(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(180000);
        conn.setInstanceFollowRedirects(true);
        conn.connect();
        int code = conn.getResponseCode();
        if (code != HttpURLConnection.HTTP_OK) {
            throw new Exception("Сервер вернул " + code);
        }

        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("Не удалось сохранить файл");
        }
        File out = new File(dir, "soulvoice-update.apk");

        try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) {
                fos.write(buf, 0, n);
            }
        } finally {
            conn.disconnect();
        }
        return out;
    }

    private void startInstall(File apk, PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                JSObject out = new JSObject();
                out.put("needPermission", true);
                call.resolve(out);
                return;
            }
        }

        Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(intent);
        call.resolve(new JSObject());
    }
}
