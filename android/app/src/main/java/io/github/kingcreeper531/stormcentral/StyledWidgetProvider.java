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
 * The extra widget styles (Temperature, Hourly, 5-day, Clock). They draw from the same
 * snapshot as {@link WeatherWidgetProvider} and share its refresh, so every
 * style updates together.
 */
public abstract class StyledWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "StormCentralWidget";

    enum Style { COMPACT, HOURLY, DAILY, CLOCK }

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
        render(context, manager, ids(context, manager, ClockWidgetProvider.class), Style.CLOCK, snapshot);
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
                int widthDp = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                RemoteViews views = style == Style.COMPACT
                        ? buildCompact(context, snapshot, heightDp, nowMs)
                        : style == Style.CLOCK
                                ? buildClock(context, snapshot, widthDp, heightDp, nowMs)
                                : buildForecast(context, snapshot, style, heightDp, nowMs);
                manager.updateAppWidget(id, views);
            } catch (RuntimeException e) {
                Log.w(TAG, "Could not draw widget " + id, e);
            }
        }
    }

    // ---- Colours -----------------------------------------------------------

    private static WidgetLook frame(Context context, RemoteViews views, WidgetLook look) {
        views.setInt(android.R.id.background, "setBackgroundResource", look.background);
        views.setOnClickPendingIntent(android.R.id.background, WeatherWidgetProvider.openApp(context));
        return look;
    }

    private static String temp(Context context, double celsius, boolean fahrenheit) {
        return Double.isNaN(celsius)
                ? context.getString(R.string.widget_temp_unknown)
                : context.getString(R.string.widget_temp, WeatherWidgetData.displayTemp(celsius, fahrenheit));
    }

    // ---- Temperature (compact) ----------------------------------------------

    private static RemoteViews buildCompact(Context context, JSONObject snapshot, int heightDp, long nowMs) {
        WidgetLook look = WidgetLook.of(context);
        RemoteViews views = new RemoteViews(context.getPackageName(), look.layout(R.layout.widget_compact, R.layout.widget_compact_clear));
        WidgetLook p = frame(context, views, look);
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
        WidgetLook look = WidgetLook.of(context);
        RemoteViews views = new RemoteViews(context.getPackageName(), look.layout(R.layout.widget_forecast, R.layout.widget_forecast_clear));
        WidgetLook p = frame(context, views, look);
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

    private static int addHours(Context context, RemoteViews views, JSONArray hours, boolean f, WidgetLook p, long nowMs) {
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

    private static int addDays(Context context, RemoteViews views, JSONArray days, boolean f, WidgetLook p, long nowMs) {
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

    // ---- Clock --------------------------------------------------------------

    /**
     * A large clock and the date (TextClock: the launcher keeps them ticking, no
     * updates needed), then today's weather. Smaller sizes drop the weather
     * details first, then the weather row, then shrink the clock.
     */
    private static RemoteViews buildClock(Context context, JSONObject snapshot, int widthDp, int heightDp, long nowMs) {
        WidgetLook look = WidgetLook.of(context);
        RemoteViews views = new RemoteViews(context.getPackageName(), look.layout(R.layout.widget_clock, R.layout.widget_clock_clear));
        WidgetLook p = frame(context, views, look);
        views.setOnClickPendingIntent(R.id.widget_clock_area, clockAppIntent(context));

        // The app's 12/24-hour setting; "auto" leaves TextClock to follow the phone.
        String clock = WeatherWidgetData.clock(context);
        String time12 = "24".equals(clock) ? "HH:mm" : "h:mm";
        String time24 = "12".equals(clock) ? "h:mm" : "HH:mm";
        views.setCharSequence(R.id.widget_clock_time, "setFormat12Hour", time12);
        views.setCharSequence(R.id.widget_clock_time, "setFormat24Hour", time24);
        views.setCharSequence(R.id.widget_clock_ampm, "setFormat12Hour", "24".equals(clock) ? "" : "a");
        views.setCharSequence(R.id.widget_clock_ampm, "setFormat24Hour", "12".equals(clock) ? "a" : "");
        String date = android.text.format.DateFormat.getBestDateTimePattern(java.util.Locale.getDefault(), "EEEMMMd");
        views.setCharSequence(R.id.widget_clock_date, "setFormat12Hour", date);
        views.setCharSequence(R.id.widget_clock_date, "setFormat24Hour", date);

        boolean tiny = heightDp > 0 && heightDp < 90;
        boolean shortWidget = heightDp > 0 && heightDp < 130;
        float timeSp = tiny ? 38f : shortWidget ? 48f : 60f;
        views.setTextViewTextSize(R.id.widget_clock_time, TypedValue.COMPLEX_UNIT_SP, timeSp);
        views.setTextColor(R.id.widget_clock_time, p.ink);
        views.setTextColor(R.id.widget_clock_ampm, p.ink2);
        views.setTextColor(R.id.widget_clock_date, p.ink2);
        views.setTextColor(R.id.widget_message, p.ink2);

        JSONObject place = snapshot == null ? null : snapshot.optJSONObject("place");
        if (place == null) {
            views.setTextViewText(R.id.widget_message, context.getString(R.string.widget_setup));
            show(views, R.id.widget_message, !tiny);
            show(views, R.id.widget_main, false);
            show(views, R.id.widget_alert, false);
            return views;
        }
        show(views, R.id.widget_message, false);

        boolean f = WeatherWidgetData.fahrenheit(snapshot);
        JSONObject now = snapshot.optJSONObject("now");
        double tempC = WeatherWidgetData.number(now, "tempC");
        int code = now == null || now.isNull("code") ? -1 : now.optInt("code", -1);
        boolean isDay = now == null || now.optBoolean("isDay", true);
        String condition = WeatherWidgetData.string(now, "text");
        if (condition == null && code >= 0) condition = WeatherWidgetData.conditionText(context, code);
        double hi = WeatherWidgetData.number(now, "hiC");
        double lo = WeatherWidgetData.number(now, "loC");
        String placeName = WeatherWidgetData.string(place, "name");
        String hilo = Double.isNaN(hi) || Double.isNaN(lo) ? null
                : context.getString(R.string.widget_hilo, WeatherWidgetData.displayTemp(hi, f), WeatherWidgetData.displayTemp(lo, f));
        // Second line: high/low and the place, as far as they fit.
        String detail = hilo == null ? placeName : placeName == null ? hilo : hilo + " · " + placeName;

        views.setTextViewText(R.id.widget_icon, code >= 0 ? WeatherWidgetData.icon(code, isDay) : "");
        views.setTextViewText(R.id.widget_temp, temp(context, tempC, f));
        views.setTextColor(R.id.widget_temp, p.ink);
        views.setTextViewText(R.id.widget_condition, condition == null ? "" : condition);
        views.setTextColor(R.id.widget_condition, p.ink);
        views.setTextViewText(R.id.widget_hilo, detail == null ? "" : detail);
        views.setTextColor(R.id.widget_hilo, p.ink2);
        show(views, R.id.widget_main, !tiny);
        show(views, R.id.widget_side, widthDp == 0 || widthDp >= 200);
        show(views, R.id.widget_hilo, detail != null && !shortWidget);

        String alert = WeatherWidgetProvider.alertLine(context, snapshot.optJSONObject("alert"), nowMs);
        views.setTextViewText(R.id.widget_alert, alert == null ? "" : alert);
        views.setTextColor(R.id.widget_alert, p.alert);
        show(views, R.id.widget_alert, alert != null && !tiny);
        return views;
    }

    /** Opens the phone's clock app (alarms), like the stock clock widgets; nothing happens if there is none. */
    private static android.app.PendingIntent clockAppIntent(Context context) {
        android.content.Intent intent = new android.content.Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        return android.app.PendingIntent.getActivity(context, 1, intent,
                android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews cell(Context context, String label, String icon, String value, WidgetLook p) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), p.layout(R.layout.widget_cell, R.layout.widget_cell_clear));
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
