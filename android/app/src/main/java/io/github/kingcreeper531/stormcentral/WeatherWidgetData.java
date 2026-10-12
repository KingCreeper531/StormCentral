package io.github.kingcreeper531.stormcentral;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Data for the home-screen widget: the snapshot the web app and the background
 * runner store, and the widget's own Open-Meteo refresh.
 *
 * <p>The snapshot is a JSON string under {@link #KEY} in the SharedPreferences
 * file the background runner's key-value store uses (its label, RUNNER_LABEL
 * in capacitor.config.ts):
 *
 * <pre>
 * { "place": { "name": "Norman, OK", "lat": 35.22, "lon": -97.44 },
 *   "unit": "F",
 *   "now": { "tempC": 24.5, "code": 95, "text": "Thunderstorm", "hiC": 31.0, "loC": 17.2,
 *            "isDay": true, "time": "2026-10-07T19:00:00Z" },
 *   "alert": { "event": "Tornado Warning", "until": "2026-10-07T20:12:00Z" },
 *   "days": [ { "date": "2026-10-07", "code": 95, "hiC": 31.0, "loC": 17.2 }, ... ],
 *   "hours": [ { "time": "2026-10-07T19:00:00Z", "code": 95, "tempC": 24.5 }, ... ],
 *   "updated": "2026-10-07T19:05:00Z" }
 * </pre>
 *
 * {@code now}, {@code alert}, {@code days} and {@code hours} may be missing or
 * null. Days are the place's local dates; hours are instants.
 */
final class WeatherWidgetData {

    /** The background runner's label, which names its SharedPreferences file. */
    static final String PREFS = "io.github.kingcreeper531.stormcentral.alerts";
    static final String KEY = "widget";

    /** Returned by {@link #parseIso} for a missing or unreadable time. */
    static final long NO_TIME = Long.MIN_VALUE;

    /** Forecast lengths the widgets show (the hourly list also has the current hour). */
    static final int DAYS = 5;
    static final int HOURS = 5;

    /** A snapshot whose conditions are newer than this is not refetched. */
    private static final long FRESH_MS = 10 * 60 * 1000L;
    private static final int TIMEOUT_MS = 10_000;
    private static final int MAX_BODY_BYTES = 256 * 1024;
    private static final String USER_AGENT = "StormCentral-Widget";

    private static final Pattern ISO = Pattern.compile(
            "(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d+))?)?"
                    + "(Z|z|[+-]\\d{2}(?::?\\d{2})?)?");

    private WeatherWidgetData() {}

    // ---- Snapshot ----------------------------------------------------------

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The app's theme setting: "light", "dark" or "system" (the default). */
    static String theme(Context context) {
        try {
            String t = prefs(context).getString("theme", null);
            return t == null ? "system" : t;
        } catch (RuntimeException e) {
            return "system";
        }
    }

    /** Whether the widgets are transparent over the wallpaper (the app's "widgetBg" setting) rather than on a panel. */
    static boolean transparent(Context context) {
        try {
            return "transparent".equals(prefs(context).getString("widgetBg", null));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The app's clock setting: "12", "24" or "auto" (follow the phone; the default). */
    static String clock(Context context) {
        try {
            String c = prefs(context).getString("clock", null);
            return "12".equals(c) || "24".equals(c) ? c : "auto";
        } catch (RuntimeException e) {
            return "auto";
        }
    }

    /** True when times should read "15:00" rather than "3:00 PM". */
    static boolean use24Hour(Context context) {
        String c = clock(context);
        if ("24".equals(c)) return true;
        if ("12".equals(c)) return false;
        return android.text.format.DateFormat.is24HourFormat(context);
    }

    /** The stored snapshot, or null when there is none or it is not a JSON object. */
    static JSONObject read(Context context) {
        String raw;
        try {
            raw = prefs(context).getString(KEY, null);
        } catch (RuntimeException e) { // e.g. ClassCastException for a non-string value
            return null;
        }
        if (raw == null) return null;
        try {
            Object value = new JSONTokener(raw).nextValue();
            if (value instanceof String) { // tolerate a double-encoded string
                value = new JSONTokener((String) value).nextValue();
            }
            return value instanceof JSONObject ? (JSONObject) value : null;
        } catch (JSONException e) {
            return null;
        }
    }

    /** The place's {lat, lon}, or null when the snapshot has no usable place. */
    static double[] coordinates(JSONObject snapshot) {
        JSONObject place = snapshot == null ? null : snapshot.optJSONObject("place");
        if (place == null) return null;
        double lat = place.optDouble("lat", Double.NaN);
        double lon = place.optDouble("lon", Double.NaN);
        // Written so NaN fails too.
        if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
        return new double[] {lat, lon};
    }

    /**
     * True when the snapshot has a place and its conditions or forecast are
     * missing, or older than 10 minutes (an hour when Google is the source:
     * its free tier is per key).
     */
    static boolean needsRefresh(Context context, JSONObject snapshot, long nowMs) {
        if (coordinates(snapshot) == null) return false;
        if (snapshot.optJSONObject("now") == null) return true;
        if (snapshot.optJSONArray("days") == null || snapshot.optJSONArray("hours") == null) return true;
        long updated = parseIso(string(snapshot, "updated"));
        long fresh = googleKey(context) != null ? GOOGLE_FRESH_MS : FRESH_MS;
        return updated == NO_TIME || Math.abs(nowMs - updated) >= fresh;
    }

    // ---- Forecast source ("Forecast from" in the app) -----------------------

    private static final long GOOGLE_FRESH_MS = 60 * 60 * 1000L;

    private static String pref(Context context, String key) {
        try {
            String v = prefs(context).getString(key, null);
            return v == null || v.trim().isEmpty() ? null : v.trim();
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The Open-Meteo model chosen in the app ("ecmwf_ifs025"), or null for the best match. */
    static String forecastModel(Context context) {
        String m = pref(context, "forecastModel");
        // Passed into a URL: only model-name characters.
        return m != null && m.matches("[a-z0-9_]{1,40}") ? m : null;
    }

    /** The person's Google key, only while Google is the chosen source. */
    static String googleKey(Context context) {
        return "google".equals(pref(context, "forecastSource")) ? pref(context, "googleKey") : null;
    }

    /**
     * Writes fresh conditions and forecast (the keys of {@code fresh}: now, days,
     * hours) into the latest stored snapshot, so a place, unit or alert written
     * meanwhile is kept, and returns it. Returns null, writing nothing, when the
     * place was removed or moved since the fetch started.
     */
    static synchronized JSONObject storeForecast(Context context, double[] fetchedFor, JSONObject fresh) {
        JSONObject latest = read(context);
        double[] place = coordinates(latest);
        if (place == null
                || Math.abs(place[0] - fetchedFor[0]) > 1e-4
                || Math.abs(place[1] - fetchedFor[1]) > 1e-4) {
            return null;
        }
        try {
            for (String key : new String[] {"now", "days", "hours"}) {
                if (fresh.has(key)) latest.put(key, fresh.get(key));
            }
            latest.put("updated", formatIso(System.currentTimeMillis()));
        } catch (JSONException e) {
            return null;
        }
        prefs(context).edit().putString(KEY, latest.toString()).commit();
        return latest;
    }

    /** Today's highlight saved by the app ("Near-record high: 84°…"), or null when there is none or it has expired. */
    static String note(JSONObject snapshot, long nowMs) {
        JSONObject note = snapshot == null ? null : snapshot.optJSONObject("note");
        String text = string(note, "text");
        if (text == null) return null;
        long until = parseIso(string(note, "until"));
        return until != NO_TIME && until <= nowMs ? null : text;
    }

    /** A non-empty string value, or null for a missing, null or empty one. */
    static String string(JSONObject object, String key) {
        if (object == null || object.isNull(key)) return null;
        Object value = object.opt(key);
        if (!(value instanceof String)) return null;
        String s = ((String) value).trim();
        return s.isEmpty() ? null : s;
    }

    /** A finite number value, or NaN. */
    static double number(JSONObject object, String key) {
        if (object == null) return Double.NaN;
        double value = object.optDouble(key, Double.NaN);
        return Double.isInfinite(value) ? Double.NaN : value;
    }

    /** Whether to show Fahrenheit: the snapshot's unit, else the locale's custom. */
    static boolean fahrenheit(JSONObject snapshot) {
        String unit = string(snapshot, "unit");
        if ("F".equalsIgnoreCase(unit)) return true;
        if ("C".equalsIgnoreCase(unit)) return false;
        String country = Locale.getDefault().getCountry();
        return "US".equals(country) || "LR".equals(country) || "MM".equals(country)
                || "BS".equals(country) || "BZ".equals(country) || "KY".equals(country)
                || "PW".equals(country);
    }

    /** A Celsius temperature rounded in the display unit. */
    static int displayTemp(double celsius, boolean fahrenheit) {
        return (int) Math.round(fahrenheit ? celsius * 9.0 / 5.0 + 32.0 : celsius);
    }

    // ---- Open-Meteo --------------------------------------------------------

    /**
     * Fetches current conditions and the short forecast as {now, days, hours}
     * (snapshot shapes). Throws on any failure.
     */
    /**
     * Conditions and forecast from the source chosen in the app: Google (with
     * the person's key), one Open-Meteo model, or the best match, falling back
     * to the best match when the chosen one fails or has nothing here.
     */
    static JSONObject fetchForecast(Context context, double lat, double lon)
            throws IOException, JSONException {
        String key = googleKey(context);
        if (key != null) {
            try {
                return fetchGoogle(context, key, lat, lon);
            } catch (IOException | JSONException | RuntimeException e) {
                // Rejected key, quota or no network: an Open-Meteo forecast below.
            }
        }
        String model = forecastModel(context);
        if (model != null) {
            try {
                return fetchOpenMeteo(context, lat, lon, model);
            } catch (IOException | JSONException e) {
                // A regional model outside its area answers with nulls: the best match below.
            }
        }
        return fetchOpenMeteo(context, lat, lon, null);
    }

    private static JSONObject fetchOpenMeteo(Context context, double lat, double lon, String model)
            throws IOException, JSONException {
        String url = String.format(Locale.US,
                "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f"
                        + "&current=temperature_2m,weather_code,is_day"
                        + "&hourly=temperature_2m,weather_code"
                        + "&daily=weather_code,temperature_2m_max,temperature_2m_min"
                        + "&timezone=auto&forecast_days=%d&forecast_hours=%d",
                lat, lon, DAYS, HOURS + 1)
                + (model == null ? "" : "&models=" + model);
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("Open-Meteo returned HTTP " + status);
            }
            try (InputStream in = connection.getInputStream()) {
                JSONObject body = new JSONObject(readBody(in));
                JSONObject out = new JSONObject();
                out.put("now", parseNow(context, body, System.currentTimeMillis()));
                out.put("days", parseDays(body));
                out.put("hours", parseHours(body));
                return out;
            }
        } finally {
            connection.disconnect();
        }
    }

    private static JSONObject getJson(String url) throws IOException, JSONException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + status);
            try (InputStream in = connection.getInputStream()) {
                return new JSONObject(readBody(in));
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Google's current conditions, next hours and days in the snapshot's shape (three calls with the person's key). */
    static JSONObject fetchGoogle(Context context, String key, double lat, double lon) throws IOException, JSONException {
        String base = "https://weather.googleapis.com/v1/";
        String loc = String.format(Locale.US, "location.latitude=%.3f&location.longitude=%.3f&key=%s",
                lat, lon, java.net.URLEncoder.encode(key, "UTF-8"));
        JSONObject current = getJson(base + "currentConditions:lookup?" + loc);
        JSONObject daysBody = getJson(base + "forecast/days:lookup?" + loc + "&days=" + DAYS + "&pageSize=" + DAYS);
        JSONObject hoursBody = getJson(base + "forecast/hours:lookup?" + loc + "&hours=" + (HOURS + 1) + "&pageSize=" + (HOURS + 1));

        double tempC = current.optJSONObject("temperature") == null ? Double.NaN : current.getJSONObject("temperature").optDouble("degrees", Double.NaN);
        if (Double.isNaN(tempC)) throw new JSONException("Google returned no temperature");
        JSONObject now = new JSONObject();
        now.put("tempC", round1(tempC));
        JSONObject cond = current.optJSONObject("weatherCondition");
        int code = googleCode(cond == null ? null : cond.optString("type", null));
        now.put("code", code);
        String text = cond == null || cond.optJSONObject("description") == null ? null : cond.getJSONObject("description").optString("text", null);
        if (text == null || text.isEmpty()) text = conditionText(context, code);
        if (text != null) now.put("text", text);
        now.put("isDay", current.optBoolean("isDaytime", true));
        long t = parseIso(string(current, "currentTime"));
        now.put("time", formatIso(t == NO_TIME ? System.currentTimeMillis() : t));

        JSONArray days = new JSONArray();
        JSONArray rawDays = daysBody.optJSONArray("forecastDays");
        for (int i = 0; rawDays != null && i < rawDays.length() && days.length() < DAYS; i++) {
            JSONObject d = rawDays.optJSONObject(i);
            JSONObject date = d == null ? null : d.optJSONObject("displayDate");
            if (date == null) continue;
            JSONObject day = new JSONObject();
            day.put("date", String.format(Locale.US, "%04d-%02d-%02d", date.optInt("year"), date.optInt("month"), date.optInt("day")));
            JSONObject daytime = d.optJSONObject("daytimeForecast");
            JSONObject dc = daytime == null ? null : daytime.optJSONObject("weatherCondition");
            if (dc != null) day.put("code", googleCode(dc.optString("type", null)));
            double hi = d.optJSONObject("maxTemperature") == null ? Double.NaN : d.getJSONObject("maxTemperature").optDouble("degrees", Double.NaN);
            double lo = d.optJSONObject("minTemperature") == null ? Double.NaN : d.getJSONObject("minTemperature").optDouble("degrees", Double.NaN);
            if (!Double.isNaN(hi)) day.put("hiC", round1(hi));
            if (!Double.isNaN(lo)) day.put("loC", round1(lo));
            if (days.length() == 0) {
                if (!Double.isNaN(hi)) now.put("hiC", round1(hi));
                if (!Double.isNaN(lo)) now.put("loC", round1(lo));
            }
            days.put(day);
        }

        JSONArray hours = new JSONArray();
        JSONArray rawHours = hoursBody.optJSONArray("forecastHours");
        for (int i = 0; rawHours != null && i < rawHours.length(); i++) {
            JSONObject h = rawHours.optJSONObject(i);
            JSONObject interval = h == null ? null : h.optJSONObject("interval");
            JSONObject temp = h == null ? null : h.optJSONObject("temperature");
            if (interval == null || temp == null || Double.isNaN(temp.optDouble("degrees", Double.NaN))) continue;
            JSONObject hour = new JSONObject();
            hour.put("time", interval.optString("startTime"));
            JSONObject hc = h.optJSONObject("weatherCondition");
            if (hc != null) hour.put("code", googleCode(hc.optString("type", null)));
            hour.put("tempC", round1(temp.optDouble("degrees")));
            hours.put(hour);
        }

        JSONObject out = new JSONObject();
        out.put("now", now);
        out.put("days", days);
        out.put("hours", hours);
        return out;
    }

    /** Google condition type ("SCATTERED_THUNDERSTORMS") → the nearest WMO code (as googleTypeToWmo in lib/google-weather.ts). */
    static int googleCode(String type) {
        String t = type == null ? "" : type.toUpperCase(Locale.US);
        if (t.isEmpty()) return 3;
        if (t.contains("THUNDER")) return 95;
        if (t.contains("HAIL")) return 96;
        if (t.equals("RAIN_AND_SNOW")) return 67;
        if (t.contains("SNOW")) return t.contains("HEAVY") || t.contains("STORM") ? 75 : t.contains("LIGHT") ? 71 : t.contains("SHOWER") ? 85 : 73;
        if (t.contains("SHOWER")) return t.contains("HEAVY") ? 82 : t.contains("LIGHT") || t.contains("CHANCE") ? 80 : 81;
        if (t.contains("RAIN")) return t.contains("HEAVY") ? 65 : t.contains("LIGHT") ? 61 : 63;
        if (t.contains("DRIZZLE")) return 53;
        if (t.contains("FOG") || t.contains("HAZE")) return 45;
        if (t.equals("CLEAR")) return 0;
        if (t.equals("MOSTLY_CLEAR")) return 1;
        if (t.equals("PARTLY_CLOUDY")) return 2;
        return 3;
    }

    private static String readBody(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
            if (out.size() > MAX_BODY_BYTES) throw new IOException("Open-Meteo response too large");
        }
        return out.toString("UTF-8");
    }

    /** Turns an Open-Meteo forecast response into a snapshot "now" object. */
    static JSONObject parseNow(Context context, JSONObject body, long fetchedAt) throws JSONException {
        JSONObject current = body.getJSONObject("current");
        double tempC = current.getDouble("temperature_2m");
        if (Double.isNaN(tempC) || Double.isInfinite(tempC)) {
            throw new JSONException("temperature_2m is not a number");
        }
        int code = current.isNull("weather_code") ? -1 : current.optInt("weather_code", -1);

        // With timezone=auto, times are the place's local wall time without an
        // offset; utc_offset_seconds turns them back into an instant.
        long local = parseIso(string(current, "time"));
        long time = local == NO_TIME
                ? fetchedAt
                : local - body.optLong("utc_offset_seconds", 0L) * 1000L;

        JSONObject now = new JSONObject();
        now.put("tempC", round1(tempC));
        if (code >= 0) now.put("code", code);
        String text = conditionText(context, code);
        if (text != null) now.put("text", text);
        JSONObject daily = body.optJSONObject("daily");
        double hi = first(daily, "temperature_2m_max");
        double lo = first(daily, "temperature_2m_min");
        if (!Double.isNaN(hi)) now.put("hiC", round1(hi));
        if (!Double.isNaN(lo)) now.put("loC", round1(lo));
        now.put("isDay", current.optInt("is_day", 1) != 0);
        now.put("time", formatIso(time));
        return now;
    }

    /** Daily forecast as snapshot "days": the place's local date, code, high and low. */
    static JSONArray parseDays(JSONObject body) throws JSONException {
        JSONArray out = new JSONArray();
        JSONObject daily = body.optJSONObject("daily");
        JSONArray dates = daily == null ? null : daily.optJSONArray("time");
        if (dates == null) return out;
        for (int i = 0; i < dates.length() && out.length() < DAYS; i++) {
            String date = dates.optString(i, "");
            if (date.length() < 10) continue;
            JSONObject day = new JSONObject();
            day.put("date", date.substring(0, 10));
            int code = at(daily, "weather_code", i) >= 0 ? (int) at(daily, "weather_code", i) : -1;
            if (code >= 0) day.put("code", code);
            double hi = at(daily, "temperature_2m_max", i);
            double lo = at(daily, "temperature_2m_min", i);
            if (!Double.isNaN(hi)) day.put("hiC", round1(hi));
            if (!Double.isNaN(lo)) day.put("loC", round1(lo));
            out.put(day);
        }
        return out;
    }

    /** Hourly forecast as snapshot "hours": instants, code and temperature. */
    static JSONArray parseHours(JSONObject body) throws JSONException {
        JSONArray out = new JSONArray();
        JSONObject hourly = body.optJSONObject("hourly");
        JSONArray times = hourly == null ? null : hourly.optJSONArray("time");
        if (times == null) return out;
        long offset = body.optLong("utc_offset_seconds", 0L) * 1000L;
        for (int i = 0; i < times.length() && out.length() < HOURS + 1; i++) {
            long local = parseIso(times.optString(i, null));
            double temp = at(hourly, "temperature_2m", i);
            if (local == NO_TIME || Double.isNaN(temp)) continue;
            JSONObject hour = new JSONObject();
            hour.put("time", formatIso(local - offset));
            hour.put("tempC", round1(temp));
            double code = at(hourly, "weather_code", i);
            if (!Double.isNaN(code)) hour.put("code", (int) code);
            out.put(hour);
        }
        return out;
    }

    /** values[key][i] as a finite number, or NaN. */
    private static double at(JSONObject block, String key, int i) {
        JSONArray values = block == null ? null : block.optJSONArray(key);
        if (values == null || i >= values.length() || values.isNull(i)) return Double.NaN;
        double value = values.optDouble(i, Double.NaN);
        return Double.isInfinite(value) ? Double.NaN : value;
    }

    private static double first(JSONObject daily, String key) {
        JSONArray values = daily == null ? null : daily.optJSONArray(key);
        if (values == null || values.length() == 0 || values.isNull(0)) return Double.NaN;
        double value = values.optDouble(0, Double.NaN);
        return Double.isInfinite(value) ? Double.NaN : value;
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    /** An emoji for a WMO weather code (the moon for clear nights). */
    static String icon(int code, boolean isDay) {
        switch (code) {
            case 0:
                return isDay ? "\u2600\uFE0F" : "\uD83C\uDF19";
            case 1:
                return isDay ? "\uD83C\uDF24\uFE0F" : "\uD83C\uDF19";
            case 2:
                return "\u26C5";
            case 3:
                return "\u2601\uFE0F";
            case 45:
            case 48:
                return "\uD83C\uDF2B\uFE0F";
            case 51:
            case 53:
            case 55:
            case 80:
            case 81:
            case 82:
                return "\uD83C\uDF26\uFE0F";
            case 56:
            case 57:
            case 61:
            case 63:
            case 65:
            case 66:
            case 67:
                return "\uD83C\uDF27\uFE0F";
            case 71:
            case 73:
            case 75:
            case 77:
            case 85:
            case 86:
                return "\uD83C\uDF28\uFE0F";
            case 95:
            case 96:
            case 99:
                return "\u26C8\uFE0F";
            default:
                return "\u2601\uFE0F";
        }
    }

    /** Short text for a WMO weather code, or null for an unknown code. */
    static String conditionText(Context context, int code) {
        int res;
        switch (code) {
            case 0:
                res = R.string.widget_cond_clear;
                break;
            case 1:
                res = R.string.widget_cond_mostly_clear;
                break;
            case 2:
                res = R.string.widget_cond_partly_cloudy;
                break;
            case 3:
                res = R.string.widget_cond_overcast;
                break;
            case 45:
            case 48:
                res = R.string.widget_cond_fog;
                break;
            case 51:
            case 53:
            case 55:
                res = R.string.widget_cond_drizzle;
                break;
            case 56:
            case 57:
            case 66:
            case 67:
                res = R.string.widget_cond_freezing_rain;
                break;
            case 61:
            case 63:
            case 65:
                res = R.string.widget_cond_rain;
                break;
            case 71:
            case 73:
            case 75:
            case 77:
            case 85:
            case 86:
                res = R.string.widget_cond_snow;
                break;
            case 80:
            case 81:
            case 82:
                res = R.string.widget_cond_showers;
                break;
            case 95:
            case 96:
            case 99:
                res = R.string.widget_cond_thunderstorm;
                break;
            default:
                return null;
        }
        return context.getString(res);
    }

    // ---- Times -------------------------------------------------------------

    /**
     * Parses an ISO 8601 date-time ("2026-10-07T19:05:00Z", "...T19:05:00.123Z",
     * "...T14:05:00-05:00", "...T14:05") to epoch milliseconds. A time without
     * an offset is read as UTC. Returns {@link #NO_TIME} when it cannot.
     */
    static long parseIso(String s) {
        if (s == null) return NO_TIME;
        Matcher m = ISO.matcher(s.trim());
        if (!m.matches()) return NO_TIME;
        Calendar calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US);
        calendar.clear();
        calendar.set(
                Integer.parseInt(m.group(1)),
                Integer.parseInt(m.group(2)) - 1,
                Integer.parseInt(m.group(3)),
                Integer.parseInt(m.group(4)),
                Integer.parseInt(m.group(5)),
                m.group(6) == null ? 0 : Integer.parseInt(m.group(6)));
        long millis = calendar.getTimeInMillis();
        String fraction = m.group(7);
        if (fraction != null) {
            String ms = (fraction + "00").substring(0, 3);
            millis += Integer.parseInt(ms);
        }
        String zone = m.group(8);
        if (zone != null && !zone.equalsIgnoreCase("Z")) {
            String digits = zone.substring(1).replace(":", "");
            int hours = Integer.parseInt(digits.substring(0, 2));
            int minutes = digits.length() >= 4 ? Integer.parseInt(digits.substring(2, 4)) : 0;
            long offset = (hours * 60L + minutes) * 60_000L;
            millis -= zone.charAt(0) == '-' ? -offset : offset;
        }
        return millis;
    }

    /** "3 PM" or "15:00" in the device's zone, following the app's clock setting. */
    static String formatHour(Context context, long millis) {
        String pattern = use24Hour(context) ? "HH:mm" : "h a";
        return new SimpleDateFormat(pattern, Locale.getDefault()).format(new Date(millis));
    }

    /** Today's date on the device ("2026-10-07"), to compare with "days" dates. */
    static String localDate(long millis) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(millis));
    }

    /** Short weekday ("Thu") for a "yyyy-MM-dd" date, or null when unreadable. */
    static String weekday(String date) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            in.setLenient(false);
            Date d = in.parse(date);
            return d == null ? null : new SimpleDateFormat("EEE", Locale.getDefault()).format(d);
        } catch (java.text.ParseException e) {
            return null;
        }
    }

    /** Formats epoch milliseconds as "2026-10-07T19:05:00Z". */
    static String formatIso(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    /**
     * A time in the device's zone and the app's 12/24-hour setting ("3:12 PM"), with the
     * weekday in front when it is not today ("Thu 3:12 PM").
     */
    static String formatTime(Context context, long millis, long nowMs) {
        Date date = new Date(millis);
        String time = new SimpleDateFormat(use24Hour(context) ? "HH:mm" : "h:mm a", Locale.getDefault()).format(date);
        Calendar then = Calendar.getInstance();
        then.setTimeInMillis(millis);
        Calendar today = Calendar.getInstance();
        today.setTimeInMillis(nowMs);
        if (then.get(Calendar.YEAR) == today.get(Calendar.YEAR)
                && then.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR)) {
            return time;
        }
        CharSequence day = android.text.format.DateFormat.format("EEE", date);
        return context.getString(R.string.widget_day_time, day, time);
    }
}
