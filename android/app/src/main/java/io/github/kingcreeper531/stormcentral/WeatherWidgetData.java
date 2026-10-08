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
 *   "updated": "2026-10-07T19:05:00Z" }
 * </pre>
 *
 * {@code now} and {@code alert} may be missing or null.
 */
final class WeatherWidgetData {

    /** The background runner's label, which names its SharedPreferences file. */
    static final String PREFS = "io.github.kingcreeper531.stormcentral.alerts";
    static final String KEY = "widget";

    /** Returned by {@link #parseIso} for a missing or unreadable time. */
    static final long NO_TIME = Long.MIN_VALUE;

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

    /** True when the snapshot has a place and its conditions are missing or older than 10 minutes. */
    static boolean needsRefresh(JSONObject snapshot, long nowMs) {
        if (coordinates(snapshot) == null) return false;
        if (snapshot.optJSONObject("now") == null) return true;
        long updated = parseIso(string(snapshot, "updated"));
        return updated == NO_TIME || Math.abs(nowMs - updated) >= FRESH_MS;
    }

    /**
     * Writes fresh conditions into the latest stored snapshot (so a place, unit
     * or alert written meanwhile is kept) and returns it. Returns null, writing
     * nothing, when the place was removed or moved since the fetch started.
     */
    static synchronized JSONObject storeNow(Context context, double[] fetchedFor, JSONObject now) {
        JSONObject latest = read(context);
        double[] place = coordinates(latest);
        if (place == null
                || Math.abs(place[0] - fetchedFor[0]) > 1e-4
                || Math.abs(place[1] - fetchedFor[1]) > 1e-4) {
            return null;
        }
        try {
            latest.put("now", now);
            latest.put("updated", formatIso(System.currentTimeMillis()));
        } catch (JSONException e) {
            return null;
        }
        prefs(context).edit().putString(KEY, latest.toString()).commit();
        return latest;
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

    /** Fetches current conditions as a snapshot "now" object. Throws on any failure. */
    static JSONObject fetchNow(Context context, double lat, double lon)
            throws IOException, JSONException {
        String url = String.format(Locale.US,
                "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f"
                        + "&current=temperature_2m,weather_code,is_day"
                        + "&daily=temperature_2m_max,temperature_2m_min"
                        + "&timezone=auto&forecast_days=1",
                lat, lon);
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
                return parseNow(context, new JSONObject(readBody(in)), System.currentTimeMillis());
            }
        } finally {
            connection.disconnect();
        }
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

    private static double first(JSONObject daily, String key) {
        JSONArray values = daily == null ? null : daily.optJSONArray(key);
        if (values == null || values.length() == 0 || values.isNull(0)) return Double.NaN;
        double value = values.optDouble(0, Double.NaN);
        return Double.isInfinite(value) ? Double.NaN : value;
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
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

    /** Formats epoch milliseconds as "2026-10-07T19:05:00Z". */
    static String formatIso(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    /**
     * A time in the device's zone and 12/24-hour setting ("3:12 PM"), with the
     * weekday in front when it is not today ("Thu 3:12 PM").
     */
    static String formatTime(Context context, long millis, long nowMs) {
        Date date = new Date(millis);
        String time = android.text.format.DateFormat.getTimeFormat(context).format(date);
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
