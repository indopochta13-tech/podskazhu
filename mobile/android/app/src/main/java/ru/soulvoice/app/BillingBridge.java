package ru.soulvoice.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Подписка через RuStore Pay SDK.
 *
 * SDK подключается отдельной сборкой: пока в проекте нет зависимости ru.rustore.sdk:pay
 * и идентификатора приложения из RuStore Консоли, мост честно отвечает «оплата недоступна»,
 * а приложение остаётся полностью рабочим на бесплатном тарифе.
 * Шаги подключения описаны в mobile/README.md, раздел «Подписка RuStore Pay SDK».
 */
@CapacitorPlugin(name = "BillingBridge")
public class BillingBridge extends Plugin {

    private static final String SDK_CLASS = "ru.rustore.sdk.pay.RuStorePayClient";

    private static boolean sdkPresent() {
        try {
            Class.forName(SDK_CLASS);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", sdkPresent());
        call.resolve(out);
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        if (!sdkPresent()) {
            JSObject out = new JSObject();
            out.put("purchaseId", "");
            out.put("status", "");
            out.put("error", "Оплата подписки появится в версии из RuStore");
            call.resolve(out);
            return;
        }
        // Подключён Pay SDK: вызов покупки живёт в RuStorePayGateway (см. README).
        RuStorePayGateway.purchase(getActivity(), call.getString("productId", ""), result -> {
            JSObject out = new JSObject();
            out.put("purchaseId", result.purchaseId);
            out.put("productId", result.productId);
            out.put("status", result.status);
            out.put("error", result.error);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void purchases(PluginCall call) {
        JSObject out = new JSObject();
        if (!sdkPresent()) {
            out.put("purchases", new JSArray());
            call.resolve(out);
            return;
        }
        RuStorePayGateway.purchases(getActivity(), list -> {
            JSArray arr = new JSArray();
            for (RuStorePayGateway.PurchaseInfo info : list) {
                JSObject item = new JSObject();
                item.put("purchaseId", info.purchaseId);
                item.put("productId", info.productId);
                item.put("status", info.status);
                arr.put(item);
            }
            out.put("purchases", arr);
            call.resolve(out);
        });
    }
}
