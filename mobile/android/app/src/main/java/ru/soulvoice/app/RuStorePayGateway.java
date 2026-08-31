package ru.soulvoice.app;

import android.app.Activity;

import java.util.ArrayList;
import java.util.List;

/**
 * Единственное место, где приложение разговаривает с RuStore Pay SDK.
 *
 * Сейчас здесь заглушка без ссылок на SDK: проект собирается и без зависимости.
 * Когда в RuStore Консоли заведены приложение и подписки, тело двух методов
 * заменяется вызовами RuStorePayClient (инструкция — mobile/README.md).
 * Контракт менять не нужно: сервер и веб-часть уже работают с этими полями.
 */
public final class RuStorePayGateway {

    private RuStorePayGateway() {
    }

    public static final class PurchaseInfo {
        public String purchaseId = "";
        public String productId = "";
        public String status = "";
        public String error = "";
    }

    public interface PurchaseCallback {
        void done(PurchaseInfo info);
    }

    public interface PurchasesCallback {
        void done(List<PurchaseInfo> list);
    }

    public static void purchase(Activity activity, String productId, PurchaseCallback callback) {
        PurchaseInfo info = new PurchaseInfo();
        info.productId = productId == null ? "" : productId;
        info.error = "Оплата подписки ещё не подключена в этой сборке";
        callback.done(info);
    }

    public static void purchases(Activity activity, PurchasesCallback callback) {
        callback.done(new ArrayList<>());
    }
}
