package io.github.kingcreeper531.stormcentral;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.SizeF;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Home-screen weather widget: the saved place's temperature, condition,
 * high/low and active warning, from the snapshot the web app and the
 * background runner store (see {@link WeatherWidgetData}).
 *
 * <p>Each update draws the stored snapshot at once, then refreshes current
 * conditions from Open-Meteo in the background and draws again. Tapping the
 * widget opens the app.
 */
public class WeatherWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "StormCentralWidget";

    /** One refresh at a time per process. */
    private static final AtomicBoolean REFRESHING = new AtomicBoolean(false);
    /** Release the broadcast well before the system's 60 s limit, even if the network hangs. */
    private static final long WATCHDOG_MS = 25_000L;
    /** RemoteViews accepts at most 16 sized layouts. */
    private static final int MAX_SIZES = 16;

    // Height estimates in dp at font scale 1, for fitting rows to the widget.
    private static final int PAD_H = 14;
    private static final int PAD_V = 12;
    private static final int PAD_V_TIGHT = 8;
    private static final int LINE_14 = 19;
    private static final int LINE_12 = 16;
    private static final int LINE_11 = 15;
    private static final int ROW_GAP = 4;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        JSONObject snapshot = WeatherWidgetData.read(context);
        render(context, manager, appWidgetIds, snapshot);
        if (WeatherWidgetData.needsRefresh(snapshot, System.currentTimeMillis())) {
            refreshAsync(context, WeatherWidgetData.coordinates(snapshot));
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(
            Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        JSONObject snapshot = WeatherWidgetData.read(context);
        try {
            manager.updateAppWidget(appWidgetId,
                    buildViews(context, snapshot, newOptions, System.currentTimeMillis()));
        } catch (RuntimeException e) {
            Log.w(TAG, "Could not draw widget " + appWidgetId, e);
        }
    }

    /**
     * Redraws every widget from the stored snapshot. Native code can call this
     * after saving a new snapshot instead of waiting for the next update.
     */
    public static void updateAll(Context context) {
        renderAll(context, WeatherWidgetData.read(context));
    }

    // ---- Refresh -----------------------------------------------------------

    private void refreshAsync(Context context, final double[] coordinates) {
        if (coordinates == null || !REFRESHING.compareAndSet(false, true)) return;
        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();
        final AtomicBoolean finished = new AtomicBoolean(false);
        final Runnable finish = () -> {
            if (finished.compareAndSet(false, true) && pending != null) pending.finish();
        };
        final Handler main = new Handler(Looper.getMainLooper());
        main.postDelayed(finish, WATCHDOG_MS);
        try {
            new Thread(() -> {
                try {
                    JSONObject now = WeatherWidgetData.fetchNow(app, coordinates[0], coordinates[1]);
                    JSONObject merged = WeatherWidgetData.storeNow(app, coordinates, now);
                    if (merged != null) renderAll(app, merged);
                } catch (Exception e) {
                    // Network or parse failure: keep showing the stored snapshot.
                    Log.w(TAG, "Widget refresh failed", e);
                } finally {
                    REFRESHING.set(false);
                    main.removeCallbacks(finish);
                    finish.run();
                }
            }, "StormCentral-Widget").start();
        } catch (RuntimeException | OutOfMemoryError e) { // thread could not start
            REFRESHING.set(false);
            main.removeCallbacks(finish);
            finish.run();
        }
    }

    // ---- Drawing -----------------------------------------------------------

    private static void renderAll(Context context, JSONObject snapshot) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return; // no widget support on this device
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, WeatherWidgetProvider.class));
        render(context, manager, ids, snapshot);
    }

    private static void render(
            Context context, AppWidgetManager manager, int[] ids, JSONObject snapshot) {
        if (ids == null) return;
        long nowMs = System.currentTimeMillis();
        for (int id : ids) {
            try {
                Bundle options = manager.getAppWidgetOptions(id);
                manager.updateAppWidget(id, buildViews(context, snapshot, options, nowMs));
            } catch (RuntimeException e) {
                Log.w(TAG, "Could not draw widget " + id, e);
            }
        }
    }

    /**
     * Views for one widget. On Android 12+ the launcher reports every size the
     * widget can appear at (portrait and landscape), and gets a layout fitted to
     * each; before that, the size for the current orientation is used.
     */
    @SuppressWarnings("deprecation") // Bundle.getParcelableArrayList(String): the typed one is API 33+
    static RemoteViews buildViews(Context context, JSONObject snapshot, Bundle options, long nowMs) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && options != null) {
            ArrayList<SizeF> sizes = null;
            try {
                sizes = options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
            } catch (RuntimeException ignored) {
                // Malformed options: fall through to the min/max sizes.
            }
            if (sizes != null && !sizes.isEmpty()) {
                Map<SizeF, RemoteViews> layouts = new HashMap<>();
                for (SizeF size : sizes) {
                    if (size == null || layouts.containsKey(size)) continue;
                    if (layouts.size() == MAX_SIZES) break;
                    layouts.put(size, buildSized(context, snapshot,
                            Math.round(size.getWidth()), Math.round(size.getHeight()), nowMs));
                }
                if (layouts.size() == 1) return layouts.values().iterator().next();
                if (!layouts.isEmpty()) return new RemoteViews(layouts);
            }
        }
        int width = 0;
        int height = 0;
        if (options != null) {
            boolean portrait = context.getResources().getConfiguration().orientation
                    != Configuration.ORIENTATION_LANDSCAPE;
            // Portrait: narrowest width, tallest height. Landscape: the reverse.
            width = options.getInt(portrait
                    ? AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH
                    : AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
            height = options.getInt(portrait
                    ? AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT
                    : AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        }
        // Unknown (first draw on some launchers): assume the default 3x2 size.
        if (width <= 0) width = 180;
        if (height <= 0) height = 110;
        return buildSized(context, snapshot, width, height, nowMs);
    }

    /** Views for a widget of widthDp x heightDp, showing the rows that fit. */
    private static RemoteViews buildSized(
            Context context, JSONObject snapshot, int widthDp, int heightDp, long nowMs) {
        Resources res = context.getResources();
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_weather);
        views.setOnClickPendingIntent(android.R.id.background, openAppIntent(context));
        applyTheme(context, views);

        float density = res.getDisplayMetrics().density;
        float fontScale = res.getConfiguration().fontScale > 0 ? res.getConfiguration().fontScale : 1f;
        int padV = heightDp < 90 ? PAD_V_TIGHT : PAD_V;
        views.setViewPadding(android.R.id.background,
                px(PAD_H, density), px(padV, density), px(PAD_H, density), px(padV, density));

        // Every update re-applies to the same views, so set every row's visibility each time.
        JSONObject place = snapshot == null ? null : snapshot.optJSONObject("place");
        if (place == null) {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_setup));
            show(views, R.id.widget_message, true);
            show(views, R.id.widget_place, false);
            show(views, R.id.widget_main, false);
            show(views, R.id.widget_condition_below, false);
            show(views, R.id.widget_hilo_below, false);
            show(views, R.id.widget_alert, false);
            show(views, R.id.widget_updated, false);
            return views;
        }
        show(views, R.id.widget_message, false);

        // ---- Text ----
        boolean fahrenheit = WeatherWidgetData.fahrenheit(snapshot);
        String placeName = WeatherWidgetData.string(place, "name");
        JSONObject now = snapshot.optJSONObject("now");
        double tempC = WeatherWidgetData.number(now, "tempC");
        String temp = Double.isNaN(tempC)
                ? context.getString(R.string.widget_temp_unknown)
                : context.getString(R.string.widget_temp,
                        WeatherWidgetData.displayTemp(tempC, fahrenheit));
        String condition;
        String hilo = null;
        if (now == null) {
            condition = context.getString(R.string.widget_no_data);
        } else {
            condition = WeatherWidgetData.string(now, "text");
            if (condition == null && !now.isNull("code")) {
                condition = WeatherWidgetData.conditionText(context, now.optInt("code", -1));
            }
            double hiC = WeatherWidgetData.number(now, "hiC");
            double loC = WeatherWidgetData.number(now, "loC");
            if (!Double.isNaN(hiC) && !Double.isNaN(loC)) {
                hilo = context.getString(R.string.widget_hilo,
                        WeatherWidgetData.displayTemp(hiC, fahrenheit),
                        WeatherWidgetData.displayTemp(loC, fahrenheit));
            }
        }
        String alert = alertText(context, snapshot.optJSONObject("alert"), nowMs);
        long updatedAt = WeatherWidgetData.parseIso(WeatherWidgetData.string(snapshot, "updated"));
        String updated = updatedAt == WeatherWidgetData.NO_TIME
                ? null
                : context.getString(R.string.widget_updated,
                        WeatherWidgetData.formatTime(context, updatedAt, nowMs));

        // ---- Fit rows to the size, most important first ----
        boolean wide = widthDp >= 200;
        int innerWidth = Math.max(widthDp - 2 * PAD_H, 1);
        int line14 = Math.round(LINE_14 * fontScale);
        int line12 = Math.round(LINE_12 * fontScale);
        int line11 = Math.round(LINE_11 * fontScale);
        int budget = heightDp - 2 * padV;

        float tempSp = heightDp >= 150 ? 48f : heightDp >= 100 ? 40f : 30f;
        int sideHeight = wide ? line14 + (hilo != null ? line12 : 0) : 0;
        int mainHeight = Math.max(Math.round(tempSp * 1.18f * fontScale), sideHeight);

        boolean showMain = true;
        boolean showAlert = alert != null;
        int alertLines = 1;
        if (showAlert) {
            // Roughly 0.55 em per character in the 12 sp medium face.
            float alertWidth = alert.length() * 0.55f * 12f * fontScale;
            int wanted = alertWidth > innerWidth ? 2 : 1;
            alertLines = wanted;
            // Make room for the warning: a smaller temperature, then fewer
            // warning lines, then no temperature row at all.
            if (budget - mainHeight < ROW_GAP + alertLines * line12) {
                tempSp = 26f;
                mainHeight = Math.max(Math.round(tempSp * 1.18f * fontScale), sideHeight);
            }
            if (budget - mainHeight < ROW_GAP + alertLines * line12) alertLines = 1;
            if (budget - mainHeight < ROW_GAP + alertLines * line12) {
                showMain = false;
                alertLines = wanted == 2 && budget >= ROW_GAP + 2 * line12 ? 2 : 1;
            }
        }
        if (showMain) budget -= mainHeight;
        if (showAlert) budget -= ROW_GAP + alertLines * line12;

        boolean showConditionBelow = false;
        boolean showHiloBelow = false;
        if (showMain && !wide && condition != null && budget >= line14) {
            showConditionBelow = true;
            budget -= line14;
        }
        boolean showPlace = placeName != null && budget >= line12;
        if (showPlace) budget -= line12;
        if (showMain && !wide && hilo != null && budget >= line12) {
            showHiloBelow = true;
            budget -= line12;
        }
        boolean showUpdated = updated != null && budget >= ROW_GAP + line11;

        // ---- Apply ----
        views.setTextViewText(R.id.widget_place, placeName == null ? "" : placeName);
        show(views, R.id.widget_place, showPlace);

        views.setTextViewText(R.id.widget_temp, temp);
        views.setTextViewTextSize(R.id.widget_temp, TypedValue.COMPLEX_UNIT_SP, tempSp);
        show(views, R.id.widget_main, showMain);
        views.setTextViewText(R.id.widget_condition, condition == null ? "" : condition);
        views.setTextViewText(R.id.widget_hilo, hilo == null ? "" : hilo);
        show(views, R.id.widget_side, wide);
        show(views, R.id.widget_condition, condition != null);
        show(views, R.id.widget_hilo, hilo != null);

        views.setTextViewText(R.id.widget_condition_below, condition == null ? "" : condition);
        show(views, R.id.widget_condition_below, showConditionBelow);
        views.setTextViewText(R.id.widget_hilo_below, hilo == null ? "" : hilo);
        show(views, R.id.widget_hilo_below, showHiloBelow);

        views.setTextViewText(R.id.widget_alert, alert == null ? "" : alert);
        views.setInt(R.id.widget_alert, "setMaxLines", alertLines);
        show(views, R.id.widget_alert, showAlert);

        views.setTextViewText(R.id.widget_updated, updated == null ? "" : updated);
        show(views, R.id.widget_updated, showUpdated);
        return views;
    }

    /** "Tornado Warning until 3:12 PM", or null when there is no alert or it has expired. */
    private static String alertText(Context context, JSONObject alert, long nowMs) {
        String event = WeatherWidgetData.string(alert, "event");
        if (event == null) return null;
        long until = WeatherWidgetData.parseIso(WeatherWidgetData.string(alert, "until"));
        if (until == WeatherWidgetData.NO_TIME) return event; // no end time given
        if (until <= nowMs) return null;
        return context.getString(R.string.widget_alert_until,
                event, WeatherWidgetData.formatTime(context, until, nowMs));
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * Light or dark colours to match the app's theme setting (saved by the app as
     * "theme": light, dark or system). System follows the phone's dark mode.
     */
    private static void applyTheme(Context context, RemoteViews views) {
        String pref = WeatherWidgetData.theme(context);
        boolean light;
        if ("light".equals(pref)) light = true;
        else if ("dark".equals(pref)) light = false;
        else {
            int night = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            light = night != Configuration.UI_MODE_NIGHT_YES;
        }
        int ink = light ? 0xFF111316 : 0xFFECECED;
        int ink2 = light ? 0xFF474C54 : 0xFFA8ACB3;
        int ink3 = light ? 0xFF61666E : 0xFF80858D;
        int alert = light ? 0xFFC62A2F : 0xFFE5484D;
        views.setInt(android.R.id.background, "setBackgroundResource",
                light ? R.drawable.widget_background_light : R.drawable.widget_background);
        for (int id : new int[] {R.id.widget_temp, R.id.widget_condition, R.id.widget_condition_below}) {
            views.setTextColor(id, ink);
        }
        for (int id : new int[] {R.id.widget_place, R.id.widget_hilo, R.id.widget_hilo_below, R.id.widget_message}) {
            views.setTextColor(id, ink2);
        }
        views.setTextColor(R.id.widget_updated, ink3);
        views.setTextColor(R.id.widget_alert, alert);
    }

    private static void show(RemoteViews views, int id, boolean visible) {
        views.setViewVisibility(id, visible ? View.VISIBLE : View.GONE);
    }

    private static int px(int dp, float density) {
        return Math.round(dp * density);
    }
}
