package io.github.kingcreeper531.stormcentral;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Storm Central's notifications on Android, done natively.
 *
 * <p>WorkManager runs this about every 15 minutes, whether the app is open,
 * closed or swiped away, and again after a reboot. The page also asks for a
 * run whenever the app comes to the front. Each run reads the settings the
 * page saved (the {@code config} JSON in the shared preferences file, see
 * lib/alerting/types.ts {@code WatchConfig}) and checks, for every watched
 * place:
 *
 * <ul>
 *   <li>NWS warnings (api.weather.gov), each announced once;</li>
 *   <li>lightning nearby (NOAA nowCOAST strike density, last 15 minutes);</li>
 *   <li>severe spotter reports nearby (the Storm Central server, when there is one);</li>
 *   <li>the morning briefing, once a day at the chosen time.</li>
 * </ul>
 *
 * Custom forecast alerts stay with the JavaScript engine (the page and the
 * background runner).
 */
public final class AlertsWorker extends Worker {

    static final String PREFS = WeatherWidgetData.PREFS;
    static final String CURRENT_PLACE = "current";

    private static final String UA = "StormCentral/0.4 (github.com/KingCreeper531/StormCentral)";
    private static final int TIMEOUT_MS = 15_000;
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final long HOUR = 3_600_000L;

    private static final String SEEN_ALERTS = "native-seen-alerts";
    private static final String SEEN_REPORTS = "native-seen-reports";
    private static final String LIGHTNING_AT = "native-lightning-at";
    private static final String BRIEFING_DAY = "native-briefing-day";
    static final String LAST_RUN = "native-last-run";
    static final String LAST_RESULT = "native-last-result";

    private static final String LIGHTNING_WMS = "https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows";
    /** One notification per place while lightning keeps going, at most this often. */
    private static final long LIGHTNING_COOLDOWN_MS = 45 * 60_000L;
    /** Spotter reports older than this aren't news any more. */
    private static final long REPORT_MAX_AGE_MS = 60 * 60_000L;
    /** A briefing missed by more than this (phone off, no network) is skipped for the day. */
    private static final long BRIEFING_WINDOW_MS = 3 * HOUR;

    public AlertsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        Notifier.ensureChannels(ctx);
        String result;
        try {
            result = runChecks(ctx, System.currentTimeMillis());
        } catch (Exception e) {
            result = "error: " + e.getClass().getSimpleName();
        }
        // Stored as text: the background runner shares this file and reads only strings.
        prefs(ctx).edit().putString(LAST_RUN, String.valueOf(System.currentTimeMillis())).putString(LAST_RESULT, result).apply();
        // The on-time briefing run plans tomorrow's.
        if (getTags().contains(AlertsScheduler.BRIEFING_TAG)) AlertsScheduler.scheduleBriefing(ctx, false);
        // Always success: the periodic schedule retries in 15 minutes anyway.
        return Result.success();
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** When the last check finished (epoch ms), or 0. */
    static long lastRun(Context ctx) {
        try {
            return Long.parseLong(prefs(ctx).getString(LAST_RUN, "0"));
        } catch (Exception e) {
            return 0;
        }
    }

    // ---- Configuration ------------------------------------------------------

    static final class Place {
        final String id;
        final String name;
        final double lat;
        final double lon;

        Place(String id, String name, double lat, double lon) {
            this.id = id;
            this.name = name;
            this.lat = lat;
            this.lon = lon;
        }
    }

    static JSONObject readConfig(Context ctx) {
        String raw = prefs(ctx).getString("config", null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<Place> places(JSONObject cfg) {
        List<Place> out = new ArrayList<>();
        JSONArray arr = cfg.optJSONArray("places");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject p = arr.optJSONObject(i);
            if (p == null || !p.has("lat") || !p.has("lon")) continue;
            out.add(new Place(p.optString("id", "p" + i), p.optString("name", "Your location"), p.optDouble("lat"), p.optDouble("lon")));
        }
        return out;
    }

    private static boolean imperial(JSONObject cfg) {
        JSONObject units = cfg.optJSONObject("units");
        return units == null || !"C".equals(units.optString("temp", "F"));
    }

    // ---- The run ------------------------------------------------------------

    /** Runs every enabled check; returns a one-line summary for the settings screen. */
    static String runChecks(Context ctx, long now) {
        JSONObject cfg = readConfig(ctx);
        if (cfg == null) return "waiting for the app to save your settings";
        JSONObject settings = cfg.optJSONObject("settings");
        if (settings == null || !settings.optBoolean("enabled", false)) return "notifications are off in Storm Central";
        if (!Notifier.allowed(ctx)) return "Android is blocking Storm Central's notifications";

        List<Place> all = places(cfg);
        boolean watchCurrent = settings.optBoolean("watchCurrent", true);
        List<Place> warningPlaces = new ArrayList<>();
        for (Place p : all) if (watchCurrent || !CURRENT_PLACE.equals(p.id)) warningPlaces.add(p);

        int sent = 0;
        int warnings = 0;
        StringBuilder problems = new StringBuilder();
        for (Place p : warningPlaces) {
            try {
                int[] r = checkWarnings(ctx, cfg, settings, p, now);
                warnings += r[0];
                sent += r[1];
            } catch (Exception e) {
                problems.append(" warnings for ").append(p.name).append(" failed;");
            }
        }

        JSONObject lightning = settings.optJSONObject("lightning");
        if (lightning != null && lightning.optBoolean("enabled", false)) {
            double km = clamp(lightning.optDouble("radiusKm", 16), 3, 50);
            for (Place p : warningPlaces) {
                try {
                    if (checkLightning(ctx, cfg, p, km, now)) sent++;
                } catch (Exception e) {
                    problems.append(" lightning check failed;");
                    break;
                }
            }
        }

        JSONObject spotter = settings.optJSONObject("spotter");
        JSONObject community = cfg.optJSONObject("community");
        if (spotter != null && spotter.optBoolean("enabled", false) && community != null && !community.optString("url", "").isEmpty()) {
            double km = clamp(spotter.optDouble("radiusKm", 40), 5, 200);
            try {
                sent += checkSpotter(ctx, cfg, community, warningPlaces, km, now);
            } catch (Exception e) {
                problems.append(" spotter reports failed;");
            }
        }

        JSONObject briefing = settings.optJSONObject("briefing");
        if (briefing != null && briefing.optBoolean("enabled", false)) {
            try {
                if (checkBriefing(ctx, cfg, briefing, all, now)) sent++;
            } catch (Exception e) {
                problems.append(" morning briefing failed;");
            }
        }

        String summary = warningPlaces.isEmpty()
                ? "no places to watch"
                : (warnings == 0 ? "no active warnings" : warnings + " active warning" + (warnings == 1 ? "" : "s"))
                        + " for " + warningPlaces.size() + " place" + (warningPlaces.size() == 1 ? "" : "s");
        if (sent > 0) summary += ", " + sent + " notification" + (sent == 1 ? "" : "s") + " sent";
        return problems.length() > 0 ? summary + "." + problems : summary;
    }

    // ---- Warnings -----------------------------------------------------------

    /** NWS event → the muteable category the settings use (mirrors alertCategory in lib/alerting/engine.ts). */
    static String category(String event) {
        String e = event.toLowerCase(Locale.US);
        if (e.contains("tornado")) return "tornado";
        if (e.matches(".*(hurricane|tropical|typhoon|storm surge).*")) return "tropical";
        if (e.contains("severe thunderstorm")) return "severe";
        if (e.contains("flood")) return "flood";
        if (e.matches(".*(fire|red flag).*")) return "fire";
        if (e.matches(".*(winter|blizzard|ice storm|snow|sleet|freez|frost|wind chill|cold).*")) return "winter";
        if (e.contains("heat")) return "heat";
        if (e.matches(".*(wind|gale|dust storm).*")) return "wind";
        return "other";
    }

    /** Returns {active matching warnings, notifications sent}. */
    private static int[] checkWarnings(Context ctx, JSONObject cfg, JSONObject settings, Place p, long now) throws Exception {
        String url = "https://api.weather.gov/alerts/active?status=actual&point=" + fmt(p.lat) + "," + fmt(p.lon);
        JSONObject res = new JSONObject(get(url, "application/geo+json"));
        JSONArray features = res.optJSONArray("features");
        if (features == null) return new int[] {0, 0};
        boolean all = "all".equals(settings.optString("level", "warnings"));
        JSONObject cats = settings.optJSONObject("categories");

        JSONObject seen = readJson(ctx, SEEN_ALERTS);
        int active = 0;
        int sent = 0;
        for (int i = 0; i < features.length(); i++) {
            JSONObject props = features.optJSONObject(i) == null ? null : features.optJSONObject(i).optJSONObject("properties");
            if (props == null) continue;
            String event = str(props, "event");
            if (event.isEmpty() || event.toLowerCase(Locale.US).contains("test message")) continue;
            String text = (str(props, "description") + " " + str(props, "headline")).toUpperCase(Locale.US);
            boolean emergency = text.contains("TORNADO EMERGENCY") || text.contains("FLASH FLOOD EMERGENCY");
            boolean isWarning = event.matches("(?i).*(warning|emergency).*") || emergency;
            if (!all && !isWarning) continue;
            if (cats != null && cats.has(category(event)) && !cats.optBoolean(category(event), true)) continue;
            String endsIso = str(props, "ends").isEmpty() ? str(props, "expires") : str(props, "ends");
            long ends = endsIso.isEmpty() ? WeatherWidgetData.NO_TIME : WeatherWidgetData.parseIso(endsIso);
            if (ends != WeatherWidgetData.NO_TIME && ends < now) continue;
            active++;
            String alertId = str(props, "id");
            String key = (alertId.isEmpty() ? event + str(props, "sent") : alertId) + "@" + p.id;
            if (seen.has(key)) continue;
            seen.put(key, ends == WeatherWidgetData.NO_TIME ? now + 6 * HOUR : ends);

            StringBuilder body = new StringBuilder();
            if (emergency) body.append(text.contains("TORNADO EMERGENCY") ? "Tornado emergency. " : "Flash flood emergency. ");
            if (text.contains("PARTICULARLY DANGEROUS SITUATION")) body.append("Particularly dangerous situation. ");
            if (ends != WeatherWidgetData.NO_TIME) body.append("Until ").append(clock(ends)).append(". ");
            String detail = (str(props, "headline").isEmpty() ? str(props, "areaDesc") : str(props, "headline")).replaceAll("\\s+", " ").trim();
            if (detail.length() > 160) detail = detail.substring(0, 157) + "…";
            body.append(detail);
            if (Notifier.show(ctx, id("warn:" + key), Notifier.WARNINGS, event + ": " + p.name, body.toString().trim())) sent++;
        }
        // Forget warnings an hour after they end.
        Iterator<String> it = seen.keys();
        List<String> stale = new ArrayList<>();
        while (it.hasNext()) {
            String k = it.next();
            if (seen.optLong(k, 0) + HOUR < now) stale.add(k);
        }
        for (String k : stale) seen.remove(k);
        writeJson(ctx, SEEN_ALERTS, seen);
        return new int[] {active, sent};
    }

    // ---- Lightning ----------------------------------------------------------

    /**
     * Fetches the strike-density map for a square around the place and finds
     * the nearest lit pixel. Returns true when a notification was sent.
     */
    private static boolean checkLightning(Context ctx, JSONObject cfg, Place p, double radiusKm, long now) throws Exception {
        JSONObject last = readJson(ctx, LIGHTNING_AT);
        if (now - last.optLong(p.id, 0) < LIGHTNING_COOLDOWN_MS) return false;
        Double nearest = nearestLightningKm(p.lat, p.lon, radiusKm);
        if (nearest == null) return false;
        last.put(p.id, now);
        writeJson(ctx, LIGHTNING_AT, last);
        boolean mi = imperial(cfg);
        double d = mi ? nearest / 1.609 : nearest;
        String dist = d < 1.5 ? (mi ? "within a mile" : "within a kilometre") : "about " + Math.round(d) + (mi ? " mi" : " km") + " away";
        return Notifier.show(ctx, id("lightning:" + p.id + ":" + (now / LIGHTNING_COOLDOWN_MS)), Notifier.LIGHTNING,
                "Lightning near " + p.name,
                "Lightning detected " + dist + " in the last 15 minutes. When thunder roars, go indoors.");
    }

    /** Distance in km to the nearest lightning within the radius, or null. */
    static Double nearestLightningKm(double lat, double lon, double radiusKm) throws Exception {
        final int size = 64;
        // Web Mercator stretches distances by 1/cos(lat).
        double half = radiusKm * 1000 / Math.cos(Math.toRadians(lat));
        double x = Math.toRadians(lon) * 6378137.0;
        double y = Math.log(Math.tan(Math.PI / 4 + Math.toRadians(lat) / 2)) * 6378137.0;
        String bbox = (x - half) + "," + (y - half) + "," + (x + half) + "," + (y + half);
        String url = LIGHTNING_WMS + "?service=WMS&version=1.3.0&request=GetMap&layers=ldn_lightning_strike_density&styles="
                + "&format=image/png&transparent=true&crs=EPSG:3857&width=" + size + "&height=" + size
                + "&bbox=" + bbox + "&_=" + (System.currentTimeMillis() / (5 * 60_000L));
        byte[] png = getBytes(url, "image/png");
        Bitmap bmp = BitmapFactory.decodeByteArray(png, 0, png.length);
        if (bmp == null) throw new IOException("not an image");
        double kmPerPx = 2 * radiusKm / size;
        double best = Double.MAX_VALUE;
        for (int py = 0; py < bmp.getHeight(); py++) {
            for (int px = 0; px < bmp.getWidth(); px++) {
                if ((bmp.getPixel(px, py) >>> 24) < 16) continue;
                double dx = (px + 0.5 - size / 2.0) * kmPerPx;
                double dy = (py + 0.5 - size / 2.0) * kmPerPx;
                best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
            }
        }
        bmp.recycle();
        return best <= radiusKm ? best : null;
    }

    // ---- Spotter reports ----------------------------------------------------

    private static final String[] SEVERE_CATEGORIES = {"tornado", "hail", "wind", "flooding"};
    private static final String[] CATEGORY_LABELS = {"Tornado or funnel cloud", "Hail", "Wind damage", "Flooding"};

    private static int checkSpotter(Context ctx, JSONObject cfg, JSONObject community, List<Place> places, double radiusKm, long now) throws Exception {
        String base = community.optString("url").replaceAll("/+$", "");
        if (!base.startsWith("https://") && !base.startsWith("http://127.0.0.1")) return 0;
        String self = str(community, "username").toLowerCase(Locale.US);
        JSONArray mutedArr = community.optJSONArray("muted");
        List<String> muted = new ArrayList<>();
        if (mutedArr != null) for (int i = 0; i < mutedArr.length(); i++) muted.add(mutedArr.optString(i).toLowerCase(Locale.US));

        JSONObject seen = readJson(ctx, SEEN_REPORTS);
        boolean mi = imperial(cfg);
        int sent = 0;
        for (Place p : places) {
            String url = base + "/api/posts?sort=nearby&lat=" + fmt(p.lat) + "&lon=" + fmt(p.lon) + "&radiusKm=" + Math.round(radiusKm);
            JSONArray posts = new JSONObject(get(url, "application/json")).optJSONArray("posts");
            if (posts == null) continue;
            for (int i = 0; i < posts.length(); i++) {
                JSONObject post = posts.optJSONObject(i);
                if (post == null) continue;
                String postId = str(post, "id");
                long created = post.optLong("createdAt", 0);
                if (postId.isEmpty() || seen.has(postId) || now - created > REPORT_MAX_AGE_MS) continue;
                JSONObject author = post.optJSONObject("author");
                String username = str(author, "username").toLowerCase(Locale.US);
                if (username.equals(self) || muted.contains(username)) continue;
                String cat = str(post, "category");
                int severity = post.optInt("severity", 0);
                int idx = indexOf(SEVERE_CATEGORIES, cat);
                if (idx < 0 && severity < 2) continue;
                seen.put(postId, created);
                double km = post.optDouble("distanceKm", 0);
                double d = mi ? km / 1.609 : km;
                String what = idx >= 0 ? CATEGORY_LABELS[idx] : (severity >= 3 ? "Dangerous weather" : "Significant weather");
                String where = d < 1 ? "nearby" : Math.round(d) + (mi ? " mi" : " km") + " from " + p.name;
                String text = str(post, "body").replaceAll("\\s+", " ").trim();
                if (text.length() > 140) text = text.substring(0, 137) + "…";
                String name = str(author, "displayName").isEmpty() ? "A spotter" : str(author, "displayName");
                if (Notifier.show(ctx, id("report:" + postId), Notifier.SPOTTER, what + " reported " + where, name + ": " + text)) sent++;
            }
        }
        Iterator<String> it = seen.keys();
        List<String> stale = new ArrayList<>();
        while (it.hasNext()) {
            String k = it.next();
            if (now - seen.optLong(k, 0) > 24 * HOUR) stale.add(k);
        }
        for (String k : stale) seen.remove(k);
        writeJson(ctx, SEEN_REPORTS, seen);
        return sent;
    }

    // ---- Morning briefing ---------------------------------------------------

    /** Minutes after midnight for "HH:MM", or 7:00. */
    static int briefingMinutes(JSONObject briefing) {
        String t = briefing.optString("time", "07:00");
        try {
            String[] parts = t.split(":");
            int m = Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
            return m >= 0 && m < 24 * 60 ? m : 7 * 60;
        } catch (Exception e) {
            return 7 * 60;
        }
    }

    /** Today's briefing time on the phone's clock, in epoch ms. */
    static long briefingAt(JSONObject briefing, long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        int m = briefingMinutes(briefing);
        c.set(Calendar.HOUR_OF_DAY, m / 60);
        c.set(Calendar.MINUTE, m % 60);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static boolean checkBriefing(Context ctx, JSONObject cfg, JSONObject briefing, List<Place> all, long now) throws Exception {
        long at = briefingAt(briefing, now);
        if (now < at || now - at > BRIEFING_WINDOW_MS) return false;
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(now));
        SharedPreferences prefs = prefs(ctx);
        if (today.equals(prefs.getString(BRIEFING_DAY, ""))) return false;
        Place place = null;
        for (Place p : all) if (CURRENT_PLACE.equals(p.id)) place = p;
        if (place == null && !all.isEmpty()) place = all.get(0);
        if (place == null) return false;

        String body = briefingText(cfg, place, prefs.getString("forecastModel", ""));
        prefs.edit().putString(BRIEFING_DAY, today).apply();
        return Notifier.show(ctx, id("briefing:" + today), Notifier.BRIEFING, "Today in " + place.name, body);
    }

    static String briefingText(JSONObject cfg, Place p, String model) throws Exception {
        String url = "https://api.open-meteo.com/v1/forecast?latitude=" + fmt(p.lat) + "&longitude=" + fmt(p.lon)
                + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_gusts_10m_max,uv_index_max"
                + "&hourly=precipitation_probability&timezone=auto&forecast_days=1&timeformat=unixtime"
                + (model != null && model.matches("[a-z0-9_]{1,40}") ? "&models=" + model : "");
        JSONObject f = new JSONObject(get(url, "application/json"));
        JSONObject d = f.getJSONObject("daily");
        boolean mi = imperial(cfg);
        JSONObject units = cfg.optJSONObject("units");
        String wind = units == null ? "mph" : units.optString("wind", "mph");

        StringBuilder s = new StringBuilder();
        int code = d.getJSONArray("weather_code").optInt(0, -1);
        if (code >= 0) s.append(WeatherWidgetData.describe(code)).append(". ");
        double hi = d.getJSONArray("temperature_2m_max").optDouble(0, Double.NaN);
        double lo = d.getJSONArray("temperature_2m_min").optDouble(0, Double.NaN);
        if (!Double.isNaN(hi)) s.append("High ").append(temp(hi, mi));
        if (!Double.isNaN(lo)) s.append(Double.isNaN(hi) ? "Low " : ", low ").append(temp(lo, mi));
        if (!Double.isNaN(hi) || !Double.isNaN(lo)) s.append(". ");

        int pop = d.getJSONArray("precipitation_probability_max").optInt(0, 0);
        if (pop >= 20) {
            s.append(pop).append("% chance of rain");
            String peak = peakRainHour(f);
            if (peak != null && pop >= 40) s.append(", most likely around ").append(peak);
            s.append(". ");
        } else {
            s.append("Little chance of rain. ");
        }
        double gust = d.getJSONArray("wind_gusts_10m_max").optDouble(0, Double.NaN);
        if (!Double.isNaN(gust) && gust >= 40) s.append("Gusts to ").append(windText(gust, wind)).append(". ");
        double uv = d.getJSONArray("uv_index_max").optDouble(0, Double.NaN);
        if (!Double.isNaN(uv) && uv >= 6) s.append("UV ").append(Math.round(uv)).append(uv >= 8 ? " (very high)" : " (high)").append(". ");
        return s.toString().trim();
    }

    /** The hour with the highest rain chance still ahead today, as "3 PM". */
    private static String peakRainHour(JSONObject f) {
        JSONObject h = f.optJSONObject("hourly");
        if (h == null) return null;
        JSONArray time = h.optJSONArray("time");
        JSONArray pop = h.optJSONArray("precipitation_probability");
        if (time == null || pop == null) return null;
        long now = System.currentTimeMillis() / 1000;
        int best = -1;
        int bestPop = -1;
        for (int i = 0; i < time.length() && i < pop.length(); i++) {
            if (time.optLong(i) + 3600 < now) continue;
            int v = pop.optInt(i, -1);
            if (v > bestPop) {
                bestPop = v;
                best = i;
            }
        }
        if (best < 0) return null;
        int offset = f.optInt("utc_offset_seconds", 0);
        SimpleDateFormat hourFmt = new SimpleDateFormat("h a", Locale.US);
        hourFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return hourFmt.format(new Date((time.optLong(best) + offset) * 1000));
    }

    private static String temp(double c, boolean f) {
        return f ? Math.round(c * 9 / 5 + 32) + "°" : Math.round(c) + "°";
    }

    private static String windText(double kmh, String unit) {
        switch (unit) {
            case "kmh": return Math.round(kmh) + " km/h";
            case "ms": return Math.round(kmh / 3.6) + " m/s";
            case "kn": return Math.round(kmh / 1.852) + " kn";
            default: return Math.round(kmh / 1.609) + " mph";
        }
    }

    // ---- Helpers ------------------------------------------------------------

    /** A string field, or "" when missing or JSON null (optString would return the text "null"). */
    static String str(JSONObject o, String key) {
        return o == null || o.isNull(key) ? "" : o.optString(key, "");
    }

    private static String clock(long ms) {
        return new SimpleDateFormat("h:mm a", Locale.US).format(new Date(ms));
    }

    private static String fmt(double v) {
        return String.format(Locale.US, "%.3f", v);
    }

    private static double clamp(double v, double lo, double hi) {
        return Double.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v));
    }

    private static int indexOf(String[] arr, String v) {
        for (int i = 0; i < arr.length; i++) if (arr[i].equals(v)) return i;
        return -1;
    }

    /** A stable positive notification id. */
    static int id(String key) {
        return key.hashCode() & 0x7fffffff;
    }

    private static JSONObject readJson(Context ctx, String key) {
        try {
            return new JSONObject(prefs(ctx).getString(key, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void writeJson(Context ctx, String key, JSONObject value) {
        prefs(ctx).edit().putString(key, value.toString()).apply();
    }

    static String get(String url, String accept) throws IOException {
        return new String(getBytes(url, accept), "UTF-8");
    }

    static byte[] getBytes(String url, String accept) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(TIMEOUT_MS);
        c.setReadTimeout(TIMEOUT_MS);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", accept);
        try {
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BYTES) throw new IOException("response too large");
                }
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }
}
