package ru.soulvoice.app;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Микрофон для записи ответов в тренажёре.
 * Разрешение просим сами, не через распознавание речи: запись идёт через getUserMedia,
 * и без выданного RECORD_AUDIO WebView отказывает без всякого диалога.
 */
@CapacitorPlugin(
        name = "MicBridge",
        permissions = {
                @Permission(alias = MicBridge.MIC, strings = { Manifest.permission.RECORD_AUDIO })
        }
)
public class MicBridge extends Plugin {

    static final String MIC = "microphone";

    private boolean googleBusy;
    private PluginCall googleCall;
    private BroadcastReceiver speechDoneReceiver;

    @Override
    public void load() {
        speechDoneReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                JSObject data = new JSObject();
                data.put("text", intent.getStringExtra("text"));
                data.put("message", intent.getStringExtra("message"));
                data.put("source", intent.getStringExtra("source"));
                data.put("cancelled", intent.getBooleanExtra("cancelled", false));
                data.put("replyKind", intent.getStringExtra("replyKind"));
                data.put("replyShelf", intent.getStringExtra("replyShelf"));
                data.put("replyItems", intent.getStringExtra("replyItems"));
                notifyListeners("speechDone", data);
            }
        };
        IntentFilter filter = new IntentFilter(WidgetRecordActivity.ACTION_SPEECH_DONE);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(speechDoneReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(speechDoneReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (speechDoneReceiver != null) {
            try {
                getContext().unregisterReceiver(speechDoneReceiver);
            } catch (Exception ignored) {}
            speechDoneReceiver = null;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (granted()) {
            call.resolve(state());
            return;
        }
        requestPermissionForAlias(MIC, call, "micResult");
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        call.resolve(state());
    }

    /**
     * Полка: тот же запуск, что у кнопки микрофона на виджете.
     * Результат приходит broadcast {@link WidgetRecordActivity#ACTION_SPEECH_DONE}.
     */
    @PluginMethod
    public void startWidgetStyleRecord(PluginCall call) {
        Context ctx = getActivity() != null ? getActivity() : getContext();
        try {
            Intent intent = WidgetRecordActivity.widgetRecordIntent(ctx);
            boolean shared = call.getBoolean("sharedList", false);
            String pairId = call.getString("pairId", "");
            if (shared) {
                intent.putExtra(WidgetRecordActivity.EXTRA_SHARED_LIST, true);
                intent.putExtra(WidgetRecordActivity.EXTRA_SOURCE, "shared");
                if (pairId != null && !pairId.isEmpty()) {
                    intent.putExtra(WidgetRecordActivity.EXTRA_PAIR_ID, pairId);
                }
            } else {
                intent.putExtra(WidgetRecordActivity.EXTRA_SOURCE, "shelf");
            }
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("launch-failed");
        }
    }

    /**
     * Системный Google STT для чата — через {@link WidgetRecordActivity} (speech_only).
     */
    @PluginMethod
    public void listenGoogle(PluginCall call) {
        if (googleBusy) {
            call.resolve(speechResult("", true, "busy"));
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(speechResult("", true, "no-recognizer"));
            return;
        }
        if (!granted()) {
            String err = getPermissionState(MIC) == PermissionState.DENIED ? "blocked" : "denied";
            call.resolve(speechResult("", true, err));
            return;
        }
        if (!GoogleSpeech.canLaunch(activity)) {
            call.resolve(speechResult("", true, "no-recognizer"));
            return;
        }
        googleBusy = true;
        googleCall = call;
        try {
            Intent intent = new Intent(activity, WidgetRecordActivity.class);
            intent.putExtra(WidgetRecordActivity.EXTRA_SPEECH_ONLY, true);
            startActivityForResult(call, intent, "onGoogleSpeech");
        } catch (Exception e) {
            clearGoogleSession();
            call.resolve(speechResult("", true, "no-recognizer"));
        }
    }

    /** Сброс зависшей сессии (отмена облака, safety-таймаут в WebView). */
    @PluginMethod
    public void cancelListenGoogle(PluginCall call) {
        PluginCall pending = googleCall;
        clearGoogleSession();
        if (pending != null) {
            pending.resolve(speechResult("", true, "cancelled"));
        }
        call.resolve();
    }

    @ActivityCallback
    private void onGoogleSpeech(PluginCall call, ActivityResult result) {
        if (!googleBusy) return;
        clearGoogleSession();
        if (call == null) return;
        int code = result != null ? result.getResultCode() : Activity.RESULT_CANCELED;
        Intent data = result != null ? result.getData() : null;
        String text = readSpeechText(code, data);
        String error = "";
        if (text.isEmpty()) {
            if (!granted()) {
                error = getPermissionState(MIC) == PermissionState.DENIED ? "blocked" : "denied";
            } else if (code == Activity.RESULT_CANCELED) {
                error = "cancelled";
            } else if (!GoogleSpeech.canLaunch(getActivity())) {
                error = "no-recognizer";
            }
        }
        call.resolve(speechResult(text, text.isEmpty(), error));
    }

    private static String readSpeechText(int code, Intent data) {
        if (data != null && data.hasExtra(WidgetRecordActivity.EXTRA_TEXT)) {
            String fromShelf = data.getStringExtra(WidgetRecordActivity.EXTRA_TEXT);
            if (fromShelf != null && !fromShelf.isEmpty()) return fromShelf.trim();
        }
        return GoogleSpeech.textFrom(code, data);
    }

    private void clearGoogleSession() {
        googleBusy = false;
        googleCall = null;
    }

    private static JSObject speechResult(String text, boolean cancelled, String error) {
        JSObject out = new JSObject();
        out.put("text", text == null ? "" : text);
        out.put("cancelled", cancelled);
        out.put("error", error == null ? "" : error);
        return out;
    }

    /** Когда пользователь выбрал «больше не спрашивать», диалог уже не придёт — только настройки. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", context.getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    private boolean granted() {
        Context context = getContext();
        return context.getPackageManager().checkPermission(
                Manifest.permission.RECORD_AUDIO,
                context.getPackageName()
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject state() {
        boolean ok = granted();
        JSObject result = new JSObject();
        result.put("granted", ok);
        // «Заблокировано» — система больше не покажет диалог, помогает только экран настроек.
        result.put("blocked", !ok && getPermissionState(MIC) == PermissionState.DENIED);
        return result;
    }
}
