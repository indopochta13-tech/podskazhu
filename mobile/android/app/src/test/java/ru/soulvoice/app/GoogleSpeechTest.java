package ru.soulvoice.app;

import android.content.ComponentName;
import android.content.Intent;
import android.speech.RecognizerIntent;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class GoogleSpeechTest {

    @Test
    public void intentMatchesWidgetGoogleDialog() {
        Intent intent = GoogleSpeech.intent();
        assertEquals(RecognizerIntent.ACTION_RECOGNIZE_SPEECH, intent.getAction());
        assertEquals(RecognizerIntent.LANGUAGE_MODEL_FREE_FORM, intent.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL));
        assertEquals("ru-RU", intent.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE));
        assertEquals("Скажите, что записать", intent.getStringExtra(RecognizerIntent.EXTRA_PROMPT));
        assertEquals(1, intent.getIntExtra(RecognizerIntent.EXTRA_MAX_RESULTS, -1));
        assertEquals(false, intent.getBooleanExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true));
        assertNull(intent.getComponent());
    }

    @Test
    public void resolveHandlerPrefersGoogleWhenAvailable() {
        Intent base = GoogleSpeech.intent();
        ComponentName handler = GoogleSpeech.resolveHandler(org.robolectric.RuntimeEnvironment.getApplication(), base);
        // На Robolectric распознавателя нет — null ожидаем.
        assertNull(handler);
        assertTrue(!GoogleSpeech.canLaunch(org.robolectric.RuntimeEnvironment.getApplication()));
    }

    @Test
    public void emptyWhenCancelled() {
        assertEquals("", GoogleSpeech.textFrom(android.app.Activity.RESULT_CANCELED, null));
        assertTrue(GoogleSpeech.textFrom(android.app.Activity.RESULT_OK, new Intent()).isEmpty());
    }
}
