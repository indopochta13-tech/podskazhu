package ru.soulvoice.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.drawable.Drawable;
import android.widget.RemoteViews;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.DrawableCompat;

import org.json.JSONObject;

/**
 * Палитра снимка виджета → цвета RemoteViews.
 * Фон полупрозрачный: виджет лежит на обоях, не закрывает их глухим прямоугольником.
 */
final class WidgetLook {
    /** ~82% непрозрачности — обои читаются, текст остаётся контрастным. */
    static final int SURFACE_ALPHA = 0xD0;
    static final int CHIP_SOFT_ALPHA = 0xE6;
    static final int BTN_SOFT_ALPHA = 0xE6;
    /** Лимит стороны bitmap для RemoteViews — иначе лаунчер «Не удалось добавить виджет». */
    static final int MAX_BITMAP_PX = 512;

    // Запас (stone light), если в снимке ещё нет полей палитры.
    static final int FALLBACK_ACCENT = 0xFF5C5248;
    static final int FALLBACK_ACCENT_SOFT = 0xFFE6E0D8;
    static final int FALLBACK_SURFACE = 0xFFFFFFFF;
    static final int FALLBACK_INK = 0xFF28241F;
    static final int FALLBACK_INK_MUTED = 0xFF746B62;

    final int accent;
    final int accentSoft;
    final int surface;
    final int ink;
    final int inkMuted;
    final int onAccent;
    final String palette;
    final String theme;

    private WidgetLook(
            int accent, int accentSoft, int surface, int ink, int inkMuted,
            String palette, String theme
    ) {
        this.accent = accent;
        this.accentSoft = accentSoft;
        this.surface = surface;
        this.ink = ink;
        this.inkMuted = inkMuted;
        this.onAccent = contrastOn(accent, ink);
        this.palette = palette == null ? "" : palette;
        this.theme = theme == null ? "" : theme;
    }

    static WidgetLook fromSnapshot(JSONObject snap) {
        if (snap == null) return defaults();
        return new WidgetLook(
                parseColor(snap.optString("accent", ""), FALLBACK_ACCENT),
                parseColor(snap.optString("accentSoft", ""), FALLBACK_ACCENT_SOFT),
                parseColor(snap.optString("surface", ""), FALLBACK_SURFACE),
                parseColor(snap.optString("ink", ""), FALLBACK_INK),
                parseColor(snap.optString("inkMuted", ""), FALLBACK_INK_MUTED),
                snap.optString("palette", "smoke"),
                snap.optString("theme", "light")
        );
    }

    static WidgetLook defaults() {
        return new WidgetLook(
                FALLBACK_ACCENT, FALLBACK_ACCENT_SOFT, FALLBACK_SURFACE,
                FALLBACK_INK, FALLBACK_INK_MUTED, "stone", "light"
        );
    }

    /** Есть ли в JSON реальные цвета палитры (не пустышка). */
    static boolean hasColors(JSONObject snap) {
        if (snap == null) return false;
        String accent = snap.optString("accent", "").trim();
        return accent.startsWith("#") || accent.startsWith("rgb");
    }

    /**
     * Подмешать look в снимок.
     * Приоритет: settings.widgetLook → previousSnap → уже лежащие в snap → дефолт stone.
     */
    static void mergeInto(JSONObject snap, JSONObject settings, JSONObject previousSnap) {
        if (snap == null) return;
        JSONObject src = null;
        if (settings != null) {
            JSONObject fromSettings = settings.optJSONObject("widgetLook");
            if (hasColors(fromSettings)) src = fromSettings;
        }
        if (src == null && hasColors(previousSnap)) src = previousSnap;
        if (src != null) {
            try {
                copyFields(src, snap);
            } catch (Exception ignored) {}
            return;
        }
        if (!hasColors(snap)) putDefaults(snap);
    }

    static JSONObject extract(JSONObject snap) {
        JSONObject look = new JSONObject();
        if (snap == null) return look;
        try {
            copyFields(snap, look);
        } catch (Exception ignored) {}
        return look;
    }

    private static void putDefaults(JSONObject snap) {
        try {
            snap.put("palette", "stone");
            snap.put("theme", "light");
            snap.put("accent", "#5c5248");
            snap.put("accentSoft", "#e6e0d8");
            snap.put("surface", "#ffffff");
            snap.put("ink", "#28241f");
            snap.put("inkMuted", "#746b62");
        } catch (Exception ignored) {}
    }

    private static void copyFields(JSONObject from, JSONObject to) throws Exception {
        String[] keys = {
                "palette", "theme", "accent", "accentSoft", "surface", "ink", "inkMuted"
        };
        for (String key : keys) {
            String v = from.optString(key, "").trim();
            if (!v.isEmpty()) to.put(key, v);
        }
    }

    /**
     * #rgb / #rrggbb / #aarrggbb / rgb() / rgba() → ARGB.
     * Без альфы в строке — непрозрачный (0xFF); альфу для фона накладываем отдельно.
     */
    static int parseColor(String raw, int fallback) {
        if (raw == null) return fallback;
        String s = raw.trim();
        if (s.isEmpty()) return fallback;
        try {
            if (s.charAt(0) == '#') {
                String hex = s.substring(1);
                if (hex.length() == 3) {
                    int r = Character.digit(hex.charAt(0), 16);
                    int g = Character.digit(hex.charAt(1), 16);
                    int b = Character.digit(hex.charAt(2), 16);
                    return Color.rgb(r * 17, g * 17, b * 17);
                }
                if (hex.length() == 6) {
                    return Color.rgb(
                            Integer.parseInt(hex.substring(0, 2), 16),
                            Integer.parseInt(hex.substring(2, 4), 16),
                            Integer.parseInt(hex.substring(4, 6), 16)
                    );
                }
                if (hex.length() == 8) {
                    return (int) Long.parseLong(hex, 16);
                }
            }
            if (s.startsWith("rgb")) {
                int open = s.indexOf('(');
                int close = s.indexOf(')');
                if (open >= 0 && close > open) {
                    String[] parts = s.substring(open + 1, close).split(",");
                    if (parts.length >= 3) {
                        int r = parseChannel(parts[0]);
                        int g = parseChannel(parts[1]);
                        int b = parseChannel(parts[2]);
                        if (parts.length >= 4) {
                            float a = Float.parseFloat(parts[3].trim());
                            if (a <= 1f) a *= 255f;
                            return Color.argb((int) a, r, g, b);
                        }
                        return Color.rgb(r, g, b);
                    }
                }
            }
            return Color.parseColor(s);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static int parseChannel(String part) {
        String t = part.trim();
        if (t.endsWith("%")) {
            float p = Float.parseFloat(t.substring(0, t.length() - 1));
            return Math.round(p * 2.55f);
        }
        return Integer.parseInt(t);
    }

    static int withAlpha(int color, int alpha) {
        return (Math.max(0, Math.min(255, alpha)) << 24) | (color & 0x00FFFFFF);
    }

    static int[] capDimensions(int widthPx, int heightPx) {
        int w = Math.max(8, widthPx);
        int h = Math.max(8, heightPx);
        int maxSide = Math.max(w, h);
        if (maxSide <= MAX_BITMAP_PX) return new int[]{w, h};
        float scale = MAX_BITMAP_PX / (float) maxSide;
        return new int[]{
                Math.max(8, Math.round(w * scale)),
                Math.max(8, Math.round(h * scale))
        };
    }

    /**
     * Tint для ImageView в RemoteViews: setInt("setColorFilter") на ImageView не работает
     * (нет метода setColorFilter(int)) — лаунчер падает на строках списка.
     */
    static void setIconTint(Context context, RemoteViews views, int viewId,
                            int drawableId, int color, int sizeDp) {
        float density = context.getResources().getDisplayMetrics().density;
        int sizePx = Math.max(24, Math.round(sizeDp * density));
        views.setImageViewBitmap(viewId, tintDrawable(context, drawableId, color, sizePx));
    }

    static Bitmap tintDrawable(Context context, int drawableId, int color, int sizePx) {
        Drawable drawable = ContextCompat.getDrawable(context, drawableId);
        if (drawable == null) {
            Bitmap empty = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
            empty.eraseColor(color);
            return empty;
        }
        drawable = DrawableCompat.wrap(drawable.mutate());
        DrawableCompat.setTint(drawable, color);
        Bitmap bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        drawable.setBounds(0, 0, sizePx, sizePx);
        drawable.draw(canvas);
        return bmp;
    }

    /** Светлый акцент → тёмный текст (ink), иначе белый. */
    static int contrastOn(int accent, int ink) {
        int r = Color.red(accent);
        int g = Color.green(accent);
        int b = Color.blue(accent);
        double lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
        return lum > 0.55 ? ink : 0xFFFFFFFF;
    }

    /**
     * @param widthDp  ширина виджета из AppWidgetOptions (для скругления без растяжки)
     * @param heightDp высота виджета
     * @param leftBtnId  id левой боковой кнопки (shared, shelves, …)
     * @param rightBtnId id правой боковой кнопки
     */
    void applyChrome(Context context, RemoteViews views, int widthDp, int heightDp,
                     String leftBtnId, String rightBtnId) {
        int surfaceBg = withAlpha(surface, SURFACE_ALPHA);
        int btnSoft = withAlpha(accentSoft, BTN_SOFT_ALPHA);

        float density = context.getResources().getDisplayMetrics().density;
        int wPx = Math.max(120, Math.round(Math.max(widthDp, 180) * density));
        int hPx = Math.max(120, Math.round(Math.max(heightDp, 180) * density));
        // Верхняя карточка ~¾ высоты, нижняя панель ~¼.
        int topH = Math.max(80, (hPx * 3) / 4);
        float cardRadius = 10f * density;
        int[] topSize = capDimensions(wPx, topH);
        // Нижняя панель — фиксированная высота, чтобы скругление совпадало с верхней карточкой.
        int botBarHeightPx = Math.round(88f * density);
        int[] botSize = capDimensions(wPx, botBarHeightPx);

        views.setImageViewBitmap(R.id.widget_top_card_bg,
                roundRectBitmap(surfaceBg, topSize[0], topSize[1], cardRadius));
        views.setImageViewBitmap(R.id.widget_bottom_bar_bg,
                roundRectBitmap(surfaceBg, botSize[0], botSize[1], cardRadius));

        views.setTextColor(R.id.widget_empty, inkMuted);
        views.setTextColor(R.id.widget_left_label, inkMuted);
        views.setTextColor(R.id.widget_right_label, inkMuted);
        views.setTextColor(R.id.widget_record_label, accent);

        float btnRadius = 10f * density;
        int btnW = Math.max(48, wPx / 3);
        int btnH = Math.round(52f * density);
        int[] btnSize = capDimensions(btnW, btnH);
        views.setImageViewBitmap(R.id.widget_left_btn_bg,
                roundRectBitmap(btnSoft, btnSize[0], btnSize[1], btnRadius));
        views.setImageViewBitmap(R.id.widget_record_btn_bg,
                roundRectBitmap(accent, btnSize[0], btnSize[1], btnRadius));
        views.setImageViewBitmap(R.id.widget_right_btn_bg,
                roundRectBitmap(btnSoft, btnSize[0], btnSize[1], btnRadius));

        setIconTint(context, views, R.id.widget_left_icon,
                drawableForSideButton(leftBtnId), accent, 32);
        setIconTint(context, views, R.id.widget_right_icon,
                drawableForSideButton(rightBtnId), accent, 32);
        setIconTint(context, views, R.id.widget_record_icon, R.drawable.ic_widget_mic, onAccent, 32);
    }

    /** Иконка боковой кнопки — как widgetSideIcon() в app.js. */
    static int drawableForSideButton(String id) {
        if (id == null || id.isEmpty() || "none".equals(id)) {
            return R.drawable.ic_widget_shelf;
        }
        switch (id) {
            case "shared":
                return R.drawable.ic_widget_shelf;
            case "shelves":
            case "meetings":
                return R.drawable.ic_widget_calendar;
            case "daily":
                return R.drawable.ic_widget_repeat;
            case "alarms":
                return R.drawable.ic_widget_alarm;
            case "notes":
                return R.drawable.ic_widget_chat;
            case "tasks":
                return R.drawable.ic_widget_tasks;
            case "buy":
                return R.drawable.ic_widget_buy;
            case "bday":
                return R.drawable.ic_widget_bday;
            case "sport":
                return R.drawable.ic_widget_sport;
            case "care":
                return R.drawable.ic_widget_care;
            case "bills":
                return R.drawable.ic_widget_bills;
            case "health":
                return R.drawable.ic_widget_health;
            case "meters":
                return R.drawable.ic_widget_meters;
            default:
                return R.drawable.ic_widget_shelf;
        }
    }

    static Bitmap roundRectBitmap(int color, int widthPx, int heightPx, float radiusPx) {
        int w = Math.max(8, widthPx);
        int h = Math.max(8, heightPx);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(color);
        float r = Math.min(radiusPx, Math.min(w, h) / 2f);
        canvas.drawRoundRect(0, 0, w, h, r, r, paint);
        return bmp;
    }

    /**
     * Вкладка даты: лёгкое скругление (не «пилюля» — текст не упирается в края).
     * @param bgViewId ImageView под фон вкладки
     * @param labelViewId TextView с подписью
     */
    void applyDayChip(Context context, RemoteViews views, int bgViewId, int labelViewId,
                      boolean on, int chipWidthDp) {
        float density = context.getResources().getDisplayMetrics().density;
        int chipH = Math.round(32f * density);
        int chipW = Math.max(48, Math.round(Math.max(chipWidthDp, 72) * density));
        float chipRadius = 10f * density;

        int bgColor = on ? accent : withAlpha(accentSoft, CHIP_SOFT_ALPHA);
        int[] chipSize = capDimensions(chipW, chipH);
        views.setImageViewBitmap(bgViewId,
                roundRectBitmap(bgColor, chipSize[0], chipSize[1], chipRadius));
        views.setTextColor(labelViewId, on ? onAccent : accent);
    }

    /** Цвета значков действий в строке записи. */
    void applyRowIcons(Context context, RemoteViews views, boolean alarmOn) {
        int muted = withAlpha(inkMuted, 0xAA);
        setIconTint(context, views, R.id.widget_item_edit, R.drawable.ic_widget_edit, muted, 32);
        setIconTint(context, views, R.id.widget_item_trash, R.drawable.ic_widget_trash, muted, 32);
        setIconTint(context, views, R.id.widget_item_phone, R.drawable.ic_widget_phone, accent, 32);
        int alarmDrawable = alarmOn ? R.drawable.ic_widget_alarm_on : R.drawable.ic_widget_alarm;
        setIconTint(context, views, R.id.widget_item_alarm, alarmDrawable, alarmOn ? accent : muted, 32);
    }

}
