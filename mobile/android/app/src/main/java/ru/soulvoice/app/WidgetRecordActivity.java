package ru.soulvoice.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Запись с виджета или полки: системный микрофон → /api/capture → обновление списка.
 * Полка запускает эту же activity с теми же flags, что и виджет.
 */
public class WidgetRecordActivity extends Activity {

    public static final String ACTION_SPEECH_DONE = "ru.soulvoice.app.SPEECH_DONE";

    /** Только распознавание — без capture на сервере (чат в WebView). */
    public static final String EXTRA_SPEECH_ONLY = "speech_only";
    public static final String EXTRA_TEXT = "speech_text";
    /** Источник capture: widget | shelf | shared */
    public static final String EXTRA_SOURCE = "capture_source";
    public static final String EXTRA_SHARED_LIST = "vc_widget_shared_list";
    public static final String EXTRA_PAIR_ID = "vc_widget_pair_id";

    private static final int REQ_MIC = 40;
    private static final int REQ_SPEECH = 41;
    private boolean launched;

    private boolean speechOnly() {
        return getIntent().getBooleanExtra(EXTRA_SPEECH_ONLY, false);
    }

    private String captureSource() {
        String source = getIntent().getStringExtra(EXTRA_SOURCE);
        if (source == null || source.isEmpty()) return "widget";
        return source;
    }

    /** Тот же intent, что у кнопки микрофона на виджете. */
    static Intent widgetRecordIntent(android.content.Context context) {
        Intent intent = new Intent(context, WidgetRecordActivity.class);
        intent.setAction(SoulVoiceWidget.ACTION_TAP);
        intent.setData(Uri.parse("soulvoice://widget/record"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return intent;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            launched = savedInstanceState.getBoolean("launched", false);
        }
        if (!launched) {
            launched = true;
            startSpeech();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        launched = false;
        startSpeech();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean("launched", launched);
    }

    private void startSpeech() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        launchGoogleSpeech();
    }

    private void launchGoogleSpeech() {
        try {
            startActivityForResult(GoogleSpeech.intent(this), REQ_SPEECH);
        } catch (Exception e) {
            if (speechOnly()) {
                setResult(RESULT_CANCELED);
                finish();
                return;
            }
            toast("Не удалось открыть микрофон");
            sendSpeechDone("", "", captureSource(), true, "", "", "[]");
            finish();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_MIC) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            launchGoogleSpeech();
            return;
        }
        if (speechOnly()) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }
        toast("Без микрофона голосовые заметки не записать");
        sendSpeechDone("", "", captureSource(), true, "", "", "[]");
        finish();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SPEECH) {
            if (speechOnly()) setResult(RESULT_CANCELED);
            else sendSpeechDone("", "", captureSource(), true, "", "", "[]");
            finish();
            return;
        }
        String text = GoogleSpeech.textFrom(resultCode, data);
        if (speechOnly()) {
            Intent out = new Intent();
            out.putExtra(EXTRA_TEXT, text);
            setResult(text.isEmpty() ? RESULT_CANCELED : RESULT_OK, out);
            finish();
            return;
        }
        if (text.isEmpty()) {
            if (resultCode == RESULT_OK) toast("Ничего не расслышала");
            sendSpeechDone("", "", captureSource(), true, "", "", "[]");
            finish();
            return;
        }
        new Thread(() -> capture(text), "widget-capture").start();
    }

    private void capture(String text) {
        String source = captureSource();
        boolean shared = getIntent().getBooleanExtra(EXTRA_SHARED_LIST, false);
        if (shared) source = "shared";
        try {
            JSONObject body = new JSONObject();
            body.put("text", text);
            body.put("source", source);
            if (shared) {
                body.put("sharedList", true);
                body.put("captureMode", "shared");
                String pairId = getIntent().getStringExtra(EXTRA_PAIR_ID);
                if (pairId != null && !pairId.isEmpty()) body.put("pairId", pairId);
            }
            JSONObject res = WidgetApi.request(this, "POST", "/api/capture", body);
            JSONObject reply = res.optJSONObject("reply");
            String message = reply != null
                    ? reply.optString("message", getString(R.string.record_ok))
                    : getString(R.string.record_ok);
            String replyKind = reply != null ? reply.optString("kind", "") : "";
            String replyShelf = "";
            String replyItemsJson = "[]";
            if (reply != null) {
                JSONArray items = reply.optJSONArray("items");
                if (items != null && items.length() > 0) {
                    replyItemsJson = items.toString();
                    JSONObject first = items.optJSONObject(0);
                    if (first != null) {
                        replyShelf = first.optString("shelf", "");
                    }
                }
            }
            WidgetApi.applyStateToWidget(this, res);
            scheduleCaptureAlarms(res);
            sendSpeechDone(text, message, source, false, replyKind, replyShelf, replyItemsJson);
            runOnUiThread(() -> {
                toast(shortToast(message, text));
                finish();
            });
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "Не удалось записать";
            sendSpeechDone(text, msg, source, true, "", "", "[]");
            runOnUiThread(() -> {
                toast(msg);
                finish();
            });
        }
    }

    private void sendSpeechDone(String text, String message, String source, boolean cancelled,
            String replyKind, String replyShelf, String replyItemsJson) {
        Intent intent = new Intent(ACTION_SPEECH_DONE);
        intent.setPackage(getPackageName());
        intent.putExtra("text", text != null ? text : "");
        intent.putExtra("message", message != null ? message : "");
        intent.putExtra("source", source != null ? source : "widget");
        intent.putExtra("cancelled", cancelled);
        intent.putExtra("replyKind", replyKind != null ? replyKind : "");
        intent.putExtra("replyShelf", replyShelf != null ? replyShelf : "");
        intent.putExtra("replyItems", replyItemsJson != null ? replyItemsJson : "[]");
        sendBroadcast(intent);
    }

    private void scheduleCaptureAlarms(JSONObject res) {
        try {
            JSONObject reply = res.optJSONObject("reply");
            if (reply != null) ReminderScheduler.scheduleItems(this, reply.optJSONArray("items"));
            JSONArray all = res.optJSONArray("items");
            if (all != null) {
                for (int i = 0; i < all.length(); i += 1) {
                    JSONObject item = all.optJSONObject(i);
                    if (item != null && item.optBoolean("alarm", false)) {
                        ReminderScheduler.scheduleItem(this, item);
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private String shortToast(String message, String spoken) {
        String m = message == null ? "" : message.trim();
        if (m.isEmpty()) m = getString(R.string.record_ok_with_text, spoken);
        if (m.length() > 80) m = m.substring(0, 77) + "…";
        return m;
    }

    private void toast(String text) {
        Toast.makeText(getApplicationContext(), text, Toast.LENGTH_SHORT).show();
    }
}
