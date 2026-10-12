package io.github.kingcreeper531.stormcentral;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The extra widget styles (Temperature, Hourly, 5-day). They draw from the same
 * snapshot as {@link WeatherWidgetProvider} and share its refresh, so every
 * style updates together.
 */
public abstract class StyledWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "StormCentralWidget";

    enum Style { COMPACT, HOURLY, DAILY }

    abstract Style style();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        JSONObject snapshot = WeatherWidgetData.read(context);
        render(context, manager, appWidgetIds, style(), snapshot);
        WeatherWidgetProvider.refreshIfStale(this, context, snapshot);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, new int[] {id}, style(), WeatherWidgetData.read(context));
    }

    /** Redraws the widgets of every extra style. */
    static void renderAllStyles(Context context, AppWidgetManager manager, JSONObject snapshot) {
        render(context, manager, ids(context, manager, CompactWidgetProvider.class), Style.COMPACT, snapshot);
        render(context, manager, ids(context, manager, HourlyWidgetProvider.class), Style.HOURLY, snapshot);
        render(context, manager, ids(context, manager, DailyWidgetProvider.class), Style.DAILY, snapshot);
    }

    private static int[] ids(Context context, AppWidgetManager manager, Class<?> cls) {
        try {
            return manager.getAppWidgetIds(new ComponentName(context, cls));
        } catch (RuntimeException e) {
            return new int[0];
        }
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids, Style style, JSONObject snapshot) {
        if (ids == null) return;
        long nowMs = System.currentTimeMillis();
        for (int id : ids) {
            try {
                Bundle options = manager.getAppWidgetOptions(id);
                int heightDp = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                RemoteViews views = style == Style.COMPACT
                        ? buildCompact(context, snapshot, heightDp, nowMs)
                        : buildForecast(context, snapshot, style, heightDp, nowMs);
                manager.updateAppWidget(id, views);
            } catch (RuntimeException e) {
                Log.w(TAG, "Could not draw widget " + id, e);
            }
        }
    }

    // ---- Colours -----------------------------------------------------------

    private static final class Palette {
        final int ink;
        final int ink2;
        final int alert;
        final int background;

        Palette(boolean light) {
            ink = light ? 0xFF111316 : 0xFFECECED;
            ink2 = light ? 0xFF474C54 : 0xFFA8ACB3;
            alert = light ? 0xFFC62A2F : 0xFFE5484D;
            background = light ? R.drawable.widget_background_light : R.drawable.widget_background;
        }
    }

    private static Palette frame(Context context, RemoteViews views) {
        Palette p = new Palette(WeatherWidgetProvider.isLight(context));
        views.setInt(android.R.id.background, "setBackgroundResource", p.background);
        views.setOnClickPendingIntent(android.R.id.background, WeatherWidgetProvider.openApp(context));
        return p;
    }

    private static String temp(Context context, double celsius, boolean fahrenheit) {
        return Double.isNaN(celsius)
                ? context.getString(R.string.widget_temp_unknown)
                : context.getString(R.string.widget_temp, WeatherWidgetData.displayTemp(celsius, fahrenheit));
    }

    // ---- Temperature (compact) ----------------------------------------------

    private static RemoteViews buildCompact(Context context, JSONObject snapshot, int heightDp, long nowMs) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_compact);
        Palette p = frame(context, views);
        JSONObject place = snapshot == null ? null : snapshot.optJSONObject("place");
        views.setTextColor(R.id.widget_message, p.ink2);
        if (place == null) {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_setup_short));
            show(views, R.id.widget_message, true);
            show(views, R.id.widget_main, false);
            show(views, R.id.widget_place, false);
            return views;
        }
        show(views, R.id.widget_message, false);
        show(views, R.id.widget_main, true);
        boolean f = WeatherWidgetData.fahrenheit(snapshot);
        JSONObject now = snapshot.optJSONObject("now");
        double tempC = WeatherWidgetData.number(now, "tempC");
        int code = now == null || now.isNull("code") ? -1 : now.optInt("code", -1);
        boolean isDay = now == null || now.optBoolean("isDay", true);

        boolean small = heightDp > 0 && heightDp < 80;
        views.setTextViewText(R.id.widget_temp, temp(context, tempC, f));
        views.setTextViewTextSize(R.id.widget_temp, TypedValue.COMPLEX_UNIT_SP, small ? 28f : 40f);
        views.setTextColor(R.id.widget_temp, p.ink);
        views.setTextViewText(R.id.widget_icon, code >= 0 ? WeatherWidgetData.icon(code, isDay) : "");
        views.setTextViewTextSize(R.id.widget_icon, TypedValue.COMPLEX_UNIT_SP, small ? 20f : 26f);

        // An active warning replaces the place name, in red.
        String alert = WeatherWidgetProvider.alertLine(context, snapshot.optJSONObject("alert"), nowMs);
        String alertEvent = alert == null ? null : WeatherWidgetData.string(snapshot.optJSONObject("alert"), "event");
        String line = alertEvent != null ? alertEvent : WeatherWidgetData.string(place, "name");
        views.setTextViewText(R.id.widget_place, line == null ? "" : line);
        views.setTextColor(R.id.widget_place, alertEvent != null ? p.alert : p.ink2);
        show(views, R.id.widget_place, line != null && !small);
        return views;
    }

    // ---- Hourly and 5-day -------------------------------------------------

    private static RemoteViews buildForecast(Context context, JSONObject snapshot, Style style, int heightDp, long nowMs) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_forecast);
        Palette p = frame(context, views);
        views.removeAllViews(R.id.widget_cells);
        views.setTextColor(R.id.widget_message, p.ink2);
        JSONObject place = snapshot == null ? null : snapshot.optJSONObject("place");
        if (place == null) {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_setup));
            show(views, R.id.widget_message, true);
            show(views, R.id.widget_header, false);
            show(views, R.id.widget_cells, false);
            show(views, R.id.widget_alert, false);
            return views;
        }
        show(views, R.id.widget_message, false);
        show(views, R.id.widget_header, true);

        boolean f = WeatherWidgetData.fahrenheit(snapshot);
        JSONObject now = snapshot.optJSONObject("now");
        double tempC = WeatherWidgetData.number(now, "tempC");
        int code = now == null || now.isNull("code") ? -1 : now.optInt("code", -1);
        boolean isDay = now == null || now.optBoolean("isDay", true);
        String condition = WeatherWidgetData.string(now, "text");
        if (condition == null && code >= 0) condition = WeatherWidgetData.conditionText(context, code);
        String placeName = WeatherWidgetData.string(place, "name");

        views.setTextViewText(R.id.widget_place, placeName == null ? "" : placeName);
        views.setTextColor(R.id.widget_place, p.ink2);
        views.setTextViewText(R.id.widget_condition, condition == null ? "" : condition);
        views.setTextColor(R.id.widget_condition, p.ink);
        views.setTextViewText(R.id.widget_icon, code >= 0 ? WeatherWidgetData.icon(code, isDay) : "");
        views.setTextViewText(R.id.widget_temp, temp(context, tempC, f));
        views.setTextColor(R.id.widget_temp, p.ink);

        String alert = WeatherWidgetProvider.alertLine(context, snapshot.optJSONObject("alert"), nowMs);
        views.setTextViewText(R.id.widget_alert, alert == null ? "" : alert);
        views.setTextColor(R.id.widget_alert, p.alert);
        // Short widgets keep the forecast row and drop the warning line.
        show(views, R.id.widget_alert, alert != null && (heightDp == 0 || heightDp >= 130));

        int added = style == Style.HOURLY
                ? addHours(context, views, snapshot.optJSONArray("hours"), f, p, nowMs)
                : addDays(context, views, snapshot.optJSONArray("days"), f, p, nowMs);
        show(views, R.id.widget_cells, added > 0);
        if (added == 0) {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_no_data));
            show(views, R.id.widget_message, true);
        }
        return views;
    }

    private static int addHours(Context context, RemoteViews views, JSONArray hours, boolean f, Palette p, long nowMs) {
        if (hours == null) return 0;
        int added = 0;
        for (int i = 0; i < hours.length() && added <= WeatherWidgetData.HOURS; i++) {
            JSONObject h = hours.optJSONObject(i);
            long t = WeatherWidgetData.parseIso(WeatherWidgetData.string(h, "time"));
            if (t == WeatherWidgetData.NO_TIME || t + 3_600_000L <= nowMs) continue; // past hours
            String label = added == 0 && t <= nowMs ? context.getString(R.string.widget_now) : WeatherWidgetData.formatHour(context, t);
            int code = h.isNull("code") ? -1 : h.optInt("code", -1);
            views.addView(R.id.widget_cells, cell(context, label, code >= 0 ? WeatherWidgetData.icon(code, isDayHour(t)) : "",
                    temp(context, WeatherWidgetData.number(h, "tempC"), f), p));
            added++;
        }
        return added;
    }

    /** A rough day/night split for hourly icons: 6 AM to 7 PM on the device's clock. */
    private static boolean isDayHour(long millis) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(millis);
        int hour = c.get(java.util.Calendar.HOUR_OF_DAY);
        return hour >= 6 && hour < 19;
    }

    private static int addDays(Context context, RemoteViews views, JSONArray days, boolean f, Palette p, long nowMs) {
        if (days == null) return 0;
        String today = WeatherWidgetData.localDate(nowMs);
        int added = 0;
        for (int i = 0; i < days.length() && added < WeatherWidgetData.DAYS; i++) {
            JSONObject d = days.optJSONObject(i);
            String date = WeatherWidgetData.string(d, "date");
            if (date == null || date.compareTo(today) < 0) continue; // past days
            String label = date.equals(today) ? context.getString(R.string.widget_today) : WeatherWidgetData.weekday(date);
            if (label == null) continue;
            int code = d.isNull("code") ? -1 : d.optInt("code", -1);
            double hi = WeatherWidgetData.number(d, "hiC");
            double lo = WeatherWidgetData.number(d, "loC");
            String value = Double.isNaN(hi) || Double.isNaN(lo)
                    ? context.getString(R.string.widget_temp_unknown)
                    : context.getString(R.string.widget_hilo_short,
                            WeatherWidgetData.displayTemp(hi, f), WeatherWidgetData.displayTemp(lo, f));
            views.addView(R.id.widget_cells, cell(context, label, code >= 0 ? WeatherWidgetData.icon(code, true) : "", value, p));
            added++;
        }
        return added;
    }

    private static RemoteViews cell(Context context, String label, String icon, String value, Palette p) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_cell);
        cell.setTextViewText(R.id.widget_cell_label, label);
        cell.setTextColor(R.id.widget_cell_label, p.ink2);
        cell.setTextViewText(R.id.widget_cell_icon, icon);
        cell.setTextViewText(R.id.widget_cell_value, value);
        cell.setTextColor(R.id.widget_cell_value, p.ink);
        return cell;
    }

    private static void show(RemoteViews views, int id, boolean visible) {
        views.setViewVisibility(id, visible ? View.VISIBLE : View.GONE);
    }
}
