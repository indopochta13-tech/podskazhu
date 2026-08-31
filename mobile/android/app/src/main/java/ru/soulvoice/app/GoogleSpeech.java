package ru.soulvoice.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.speech.RecognizerIntent;

import java.util.ArrayList;

/**
 * Один и тот же системный микрофон Google — и в виджете, и в приложении.
 * Не SpeechRecognizer в фоне: он на части прошивок не отпускает сессию.
 */
final class GoogleSpeech {

    static final String GOOGLE_VOICE = "com.google.android.googlequicksearchbox";

    private GoogleSpeech() {}

    static Intent intent() {
        return intent(null);
    }

    static Intent intent(Context ctx) {
        Intent intent = baseIntent();
        ComponentName handler = ctx != null ? resolveHandler(ctx, intent) : null;
        if (handler != null) {
            intent.setComponent(handler);
        }
        return intent;
    }

    static boolean canLaunch(Context ctx) {
        return ctx != null && resolveHandler(ctx, baseIntent()) != null;
    }

    private static Intent baseIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Скажите, что записать");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
        return intent;
    }

    /**
     * Сначала Google app (как виджет), иначе любой системный распознаватель речи.
     */
    static ComponentName resolveHandler(Context ctx, Intent base) {
        PackageManager pm = ctx.getPackageManager();
        Intent google = new Intent(base);
        google.setPackage(GOOGLE_VOICE);
        ResolveInfo googleInfo = pm.resolveActivity(google, PackageManager.MATCH_DEFAULT_ONLY);
        if (googleInfo != null && googleInfo.activityInfo != null) {
            return new ComponentName(googleInfo.activityInfo.packageName, googleInfo.activityInfo.name);
        }
        ResolveInfo any = pm.resolveActivity(base, PackageManager.MATCH_DEFAULT_ONLY);
        if (any != null && any.activityInfo != null) {
            return new ComponentName(any.activityInfo.packageName, any.activityInfo.name);
        }
        return null;
    }

    static String textFrom(int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK || data == null) return "";
        ArrayList<String> texts = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (texts == null || texts.isEmpty()) return "";
        String text = texts.get(0);
        return text == null ? "" : text.trim();
    }
}
