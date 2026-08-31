package ru.soulvoice.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Действия строки виджета: удаление и будильник — без UI приложения;
 * редактирование — сразу в карточку заметки.
 */
public class WidgetRowActionActivity extends Activity {

    /** Не даём одному id уйти двумя параллельными cancel при тройном тапе. */
    private static final Set<String> INFLIGHT = Collections.synchronizedSet(new HashSet<>());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Поворот / пересоздание не должны слать второй cancel.
        if (savedInstanceState != null) {
            finish();
            return;
        }
        Intent intent = getIntent();
        String action = intent != null ? intent.getStringExtra(SoulVoiceWidget.EXTRA_ACTION) : "";
        String itemId = intent != null ? intent.getStringExtra(SoulVoiceWidget.EXTRA_ITEM) : "";
        if (action == null) action = "";
        if (itemId == null) itemId = "";
        // Иногда fill-in кладёт id только в data URI.
        if (itemId.isEmpty() && intent != null && intent.getData() != null) {
            String path = intent.getData().getPath();
            // soulvoice://widget-row/trash/{id}/{pos}
            if (path != null) {
                String[] parts = path.split("/");
                if (parts.length >= 4) itemId = parts[3];
            }
        }

        if ("edit".equals(action) || "open".equals(action)) {
            Intent open = new Intent(this, MainActivity.class);
            open.setAction(SoulVoiceWidget.ACTION_TAP);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra(SoulVoiceWidget.EXTRA_ACTION, "edit");
            open.putExtra(SoulVoiceWidget.EXTRA_SHELF, "");
            open.putExtra(SoulVoiceWidget.EXTRA_ITEM, itemId);
            startActivity(open);
            finish();
            return;
        }

        if ("call".equals(action) && !itemId.isEmpty()) {
            JSONObject local = WidgetApi.findLocalItem(this, itemId);
            String phone = local != null ? local.optString("phone", "").trim() : "";
            if (!phone.isEmpty()) {
                String digits = phone.replaceAll("[^\\d+]", "");
                if (!digits.isEmpty()) {
                    Intent dial = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + digits));
                    dial.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(dial);
                }
            }
            finish();
            return;
        }

        if (("trash".equals(action) || "alarm".equals(action)) && !itemId.isEmpty()) {
            final String act = action;
            final String id = itemId;
            if ("trash".equals(act) && !INFLIGHT.add(id)) {
                finish();
                return;
            }
            new Thread(() -> {
                try {
                    runSilent(act, id);
                } finally {
                    if ("trash".equals(act)) INFLIGHT.remove(id);
                }
            }, "widget-row").start();
            return;
        }

        finish();
    }

    private void runSilent(String action, String itemId) {
        try {
            if ("trash".equals(action)) {
                // Сразу убираем строку локально — иначе пустой снимок раньше блокировался
                // и тост «Удалила» приходил при живой карточке на виджете.
                ReminderScheduler.cancelItem(this, itemId);
                WidgetApi.patchLocalItem(this, itemId, null, true);
                try {
                    JSONObject res = WidgetApi.request(this, "POST", "/api/items/" + itemId + "/cancel", new JSONObject());
                    if (res.has("items")) WidgetApi.applyStateToWidget(this, res);
                    else WidgetApi.patchLocalItem(this, itemId, null, true);
                    // Ещё раз форсируем пересборку: последняя заметка даёт пустой список.
                    SoulVoiceWidget.refresh(this);
                    uiToast("Удалила");
                } catch (Exception e) {
                    // Уже сняли локально; если сервер сказал «не найдено» — тоже ок.
                    String msg = e.getMessage() != null ? e.getMessage() : "";
                    if (msg.contains("404") || msg.contains("Не найдено")) {
                        WidgetApi.patchLocalItem(this, itemId, null, true);
                        SoulVoiceWidget.refresh(this);
                        uiToast("Удалила");
                    } else {
                        uiToast(msg.isEmpty() ? "Не удалось удалить" : msg);
                    }
                }
            } else {
                boolean current = WidgetApi.localAlarm(this, itemId);
                boolean next = !current;
                // Сразу в сырой state — иначе refresh откатит иконку.
                WidgetApi.patchLocalItem(this, itemId, next, false);
                if (next) {
                    JSONObject local = WidgetApi.findLocalItem(this, itemId);
                    if (local != null) ReminderScheduler.scheduleItem(this, local);
                } else {
                    ReminderScheduler.cancelItem(this, itemId);
                }
                JSONObject body = new JSONObject();
                body.put("alarm", next);
                JSONObject res = WidgetApi.request(this, "PATCH", "/api/items/" + itemId, body);
                // Как у корзины: полный state обновляет KEY_STATE_ITEMS + снимок.
                if (res.has("items")) {
                    WidgetApi.applyStateToWidget(this, res);
                } else {
                    JSONObject updated = res.optJSONObject("item");
                    if (updated != null) WidgetApi.mergeLocalItem(this, updated);
                }
                JSONObject updated = res.optJSONObject("item");
                if (updated != null) {
                    if (updated.optBoolean("alarm", next)) ReminderScheduler.scheduleItem(this, updated);
                    else ReminderScheduler.cancelItem(this, itemId);
                }
                uiToast(next ? "Будильник включён" : "Будильник выключен");
            }
        } catch (Exception e) {
            uiToast(e.getMessage() != null ? e.getMessage() : "Не удалось");
        } finally {
            runOnUiThread(this::finish);
        }
    }

    private void uiToast(String text) {
        runOnUiThread(() -> Toast.makeText(getApplicationContext(), text, Toast.LENGTH_SHORT).show());
    }
}
