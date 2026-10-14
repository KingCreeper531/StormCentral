package io.github.kingcreeper531.stormcentral;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.webkit.CookieManager;

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
 *   <li>the morning briefing, once a day at the chosen time;</li>
 *   <li>rain or snow about to start at your location (Open-Meteo 15-minute forecast);</li>
 *   <li>strong radar storms heading for a place (the Storm Central server's /api/storm-eta);</li>
 *   <li>confirmations and comments on your own reports (/api/activity, with the app's sign-in cookie).</li>
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
    private static final String RAIN_AT = "native-rain-at";
    private static final String STORMS_SEEN = "native-storms-seen";
    private static final String ACTIVITY_SINCE = "native-activity-since";
    /** The checks this build runs, reported to the page (StormAlertsPlugin.status) so it skips them. */
    static final String[] FEATURES = {"warnings", "lightning", "spotter", "briefing", "rain", "storms", "activity"};
    static final String LAST_RUN = "native-last-run";
    static final String LAST_RESULT = "native-last-result";

    private static final String LIGHTNING_WMS = "https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows";
    /** One notification per place while lightning keeps going, at most this often. */
    private static final long LIGHTNING_COOLDOWN_MS = 45 * 60_000L;
    /** Spotter reports older than this aren't news any more. */
    private static final long REPORT_MAX_AGE_MS = 60 * 60_000L;
    /** A briefing missed by more than this (phone off, no network) is skipped for the day. */
    private static final long BRIEFING_WINDOW_MS = 3 * HOUR;
    /** One rain-soon notification per spell (lib/alerting/extras.ts RAIN_COOLDOWN_MS). */
    private static final long RAIN_COOLDOWN_MS = 90 * 60_000L;
    /** The same storm isn't announced twice for a place within this long. */
    private static final long STORM_REPEAT_MS = 90 * 60_000L;
    /** Below this many mm in 15 minutes it's dry (lib/weather/rain-outlook.ts WET_MM). */
    private static final double WET_MM = 0.1;

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

        JSONObject rain = settings.optJSONObject("rain");
        if (rain != null && rain.optBoolean("enabled", false)) {
            try {
                if (checkRain(ctx, cfg, rain, all, now)) sent++;
            } catch (Exception e) {
                problems.append(" rain check failed;");
            }
        }

        String server = serverBase(cfg);
        JSONObject storms = settings.optJSONObject("storms");
        if (storms != null && storms.optBoolean("enabled", false) && server != null) {
            try {
                sent += checkStorms(ctx, cfg, server, warningPlaces, now);
            } catch (Exception e) {
                problems.append(" storm check failed;");
            }
        }

        JSONObject activity = settings.optJSONObject("activity");
        if (activity != null && activity.optBoolean("enabled", false) && community != null && !str(community, "username").isEmpty()) {
            String base = cleanBase(community.optString("url", ""));
            try {
                if (base != null) sent += checkActivity(ctx, cfg, base, now);
            } catch (Exception e) {
                problems.append(" report activity failed;");
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

            boolean es = Lang.spanish(cfg);
            StringBuilder body = new StringBuilder();
            if (emergency) body.append(text.contains("TORNADO EMERGENCY") ? Lang.pick(es, "Tornado emergency. ", "Emergencia de tornado. ") : Lang.pick(es, "Flash flood emergency. ", "Emergencia de inundación repentina. "));
            if (text.contains("PARTICULARLY DANGEROUS SITUATION")) body.append(Lang.pick(es, "Particularly dangerous situation. ", "Situación particularmente peligrosa. "));
            if (ends != WeatherWidgetData.NO_TIME) body.append(Lang.pick(es, "Until ", "Hasta las ")).append(clock(ends, es)).append(". ");
            String detail = (str(props, "headline").isEmpty() ? str(props, "areaDesc") : str(props, "headline")).replaceAll("\\s+", " ").trim();
            if (detail.length() > 160) detail = detail.substring(0, 157) + "…";
            body.append(detail);
            if (Notifier.show(ctx, id("warn:" + key), Notifier.WARNINGS, Lang.event(es, event) + ": " + p.name, body.toString().trim())) sent++;
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
        boolean es = Lang.spanish(cfg);
        double d = mi ? nearest / 1.609 : nearest;
        String unit = mi ? "mi" : "km";
        String dist = d < 1.5
                ? (mi ? Lang.pick(es, "within a mile", "a menos de una milla") : Lang.pick(es, "within a kilometre", "a menos de un kilómetro"))
                : Lang.fill(Lang.pick(es, "about {n} {unit} away", "a unos {n} {unit}"), "n", Math.round(d), "unit", unit);
        return Notifier.show(ctx, id("lightning:" + p.id + ":" + (now / LIGHTNING_COOLDOWN_MS)), Notifier.LIGHTNING,
                Lang.fill(Lang.pick(es, "Lightning near {place}", "Rayos cerca de {place}"), "place", p.name),
                Lang.fill(Lang.pick(es, "Lightning detected {distance} in the last 15 minutes. When thunder roars, go indoors.",
                        "Se detectaron rayos {distance} en los últimos 15 minutos. Si oyes truenos, entra a un lugar cerrado."), "distance", dist));
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
    private static final String[] CATEGORY_LABELS_ES = {"Tornado o nube embudo", "Granizo", "Daños por viento", "Inundación"};

    private static int checkSpotter(Context ctx, JSONObject cfg, JSONObject community, List<Place> places, double radiusKm, long now) throws Exception {
        String base = cleanBase(community.optString("url"));
        if (base == null) return 0;
        boolean es = Lang.spanish(cfg);
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
                String what = idx >= 0 ? (es ? CATEGORY_LABELS_ES[idx] : CATEGORY_LABELS[idx])
                        : (severity >= 3 ? Lang.pick(es, "Dangerous weather", "Tiempo peligroso") : Lang.pick(es, "Significant weather", "Tiempo significativo"));
                String title = d < 1
                        ? Lang.fill(Lang.pick(es, "{what} reported nearby", "{what} reportado cerca"), "what", what)
                        : Lang.fill(Lang.pick(es, "{what} reported {n} {unit} from {place}", "{what} reportado a {n} {unit} de {place}"),
                                "what", what, "n", Math.round(d), "unit", mi ? "mi" : "km", "place", p.name);
                String text = str(post, "body").replaceAll("\\s+", " ").trim();
                if (text.length() > 140) text = text.substring(0, 137) + "…";
                String name = str(author, "displayName").isEmpty() ? Lang.pick(es, "A spotter", "Un observador") : str(author, "displayName");
                if (Notifier.show(ctx, id("report:" + postId), Notifier.SPOTTER, title, name + ": " + text)) sent++;
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
        return Notifier.show(ctx, id("briefing:" + today), Notifier.BRIEFING,
                Lang.fill(Lang.pick(Lang.spanish(cfg), "Today in {place}", "Hoy en {place}"), "place", place.name), body);
    }

    static String briefingText(JSONObject cfg, Place p, String model) throws Exception {
        String url = "https://api.open-meteo.com/v1/forecast?latitude=" + fmt(p.lat) + "&longitude=" + fmt(p.lon)
                + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_gusts_10m_max,uv_index_max"
                + "&hourly=precipitation_probability&timezone=auto&forecast_days=1&timeformat=unixtime"
                + (model != null && model.matches("[a-z0-9_]{1,40}") ? "&models=" + model : "");
        JSONObject f = new JSONObject(get(url, "application/json"));
        JSONObject d = f.getJSONObject("daily");
        boolean mi = imperial(cfg);
        boolean es = Lang.spanish(cfg);
        JSONObject units = cfg.optJSONObject("units");
        String wind = units == null ? "mph" : units.optString("wind", "mph");

        StringBuilder s = new StringBuilder();
        int code = d.getJSONArray("weather_code").optInt(0, -1);
        if (code >= 0) s.append(es ? WeatherWidgetData.describeEs(code) : WeatherWidgetData.describe(code)).append(". ");
        double hi = d.getJSONArray("temperature_2m_max").optDouble(0, Double.NaN);
        double lo = d.getJSONArray("temperature_2m_min").optDouble(0, Double.NaN);
        if (!Double.isNaN(hi) && !Double.isNaN(lo)) {
            s.append(Lang.fill(Lang.pick(es, "High {hi}, low {lo}.", "Máxima de {hi}, mínima de {lo}."), "hi", temp(hi, mi), "lo", temp(lo, mi))).append(" ");
        } else if (!Double.isNaN(hi)) {
            s.append(Lang.fill(Lang.pick(es, "High {hi}.", "Máxima de {hi}."), "hi", temp(hi, mi))).append(" ");
        }

        int pop = d.getJSONArray("precipitation_probability_max").optInt(0, 0);
        if (pop >= 20) {
            String peak = peakRainHour(f, es);
            s.append(peak != null && pop >= 40
                    ? Lang.fill(Lang.pick(es, "{pop}% chance of rain, most likely around {time}.", "{pop}% de probabilidad de lluvia, sobre todo cerca de las {time}."), "pop", pop, "time", peak)
                    : Lang.fill(Lang.pick(es, "{pop}% chance of rain.", "{pop}% de probabilidad de lluvia."), "pop", pop)).append(" ");
        } else {
            s.append(Lang.pick(es, "Little chance of rain.", "Poca probabilidad de lluvia.")).append(" ");
        }
        double gust = d.getJSONArray("wind_gusts_10m_max").optDouble(0, Double.NaN);
        if (!Double.isNaN(gust) && gust >= 40) s.append(Lang.fill(Lang.pick(es, "Gusts to {wind}.", "Ráfagas de hasta {wind}."), "wind", windText(gust, wind))).append(" ");
        double uv = d.getJSONArray("uv_index_max").optDouble(0, Double.NaN);
        if (!Double.isNaN(uv) && uv >= 6) {
            s.append(Lang.fill(uv >= 8 ? Lang.pick(es, "UV {uv} (very high).", "UV {uv} (muy alto).") : Lang.pick(es, "UV {uv} (high).", "UV {uv} (alto)."), "uv", Math.round(uv))).append(" ");
        }
        return s.toString().trim();
    }

    /** The hour with the highest rain chance still ahead today, as "3 PM" (or "3 p. m."). */
    private static String peakRainHour(JSONObject f, boolean es) {
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
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.setTimeInMillis((time.optLong(best) + offset) * 1000);
        int h = c.get(Calendar.HOUR_OF_DAY);
        return (h % 12 == 0 ? 12 : h % 12) + " " + Lang.ampm(es, h < 12);
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

    // ---- Rain starting soon -------------------------------------------------

    /**
     * Port of lib/weather/rain-outlook.ts rainOutlook for the "starting" case:
     * {startsInMin, endsInMin (-1 past the forecast), peakMm, horizonMin}, or
     * null when it isn't about to start. Each value is the 15 minutes before its time.
     */
    static double[] rainStart(JSONArray times, JSONArray precip, long now) {
        int n = Math.min(times.length(), precip.length());
        int first = -1;
        for (int i = 0; i < n; i++) {
            if (times.optLong(i) * 1000 > now) {
                first = i;
                break;
            }
        }
        if (first < 0) return null;
        int start = first;
        while (start < n && precip.optDouble(start, 0) < WET_MM) start++;
        if (start >= n || start == first) return null; // dry, or already raining
        int stop = start;
        double peak = 0;
        while (stop < n && precip.optDouble(stop, 0) >= WET_MM) peak = Math.max(peak, precip.optDouble(stop++, 0));
        double startsIn = Math.max(0, (times.optLong(start) * 1000 - 15 * 60_000L - now) / 60_000.0);
        double endsIn = stop < n ? Math.max(0, (times.optLong(stop - 1) * 1000 - now) / 60_000.0) : -1;
        double horizon = Math.max(0, (times.optLong(n - 1) * 1000 - now) / 60_000.0);
        return new double[] {startsIn, endsIn, peak, horizon};
    }

    private static boolean checkRain(Context ctx, JSONObject cfg, JSONObject rain, List<Place> all, long now) throws Exception {
        SharedPreferences prefs = prefs(ctx);
        long last;
        try {
            last = Long.parseLong(prefs.getString(RAIN_AT, "0"));
        } catch (Exception e) {
            last = 0;
        }
        if (now - last < RAIN_COOLDOWN_MS) return false;
        Place place = null;
        for (Place p : all) if (CURRENT_PLACE.equals(p.id)) place = p;
        if (place == null && !all.isEmpty()) place = all.get(0);
        if (place == null) return false;

        String url = "https://api.open-meteo.com/v1/forecast?latitude=" + fmt(place.lat) + "&longitude=" + fmt(place.lon)
                + "&minutely_15=precipitation&forecast_minutely_15=13&past_minutely_15=1&current=temperature_2m&timeformat=unixtime&timezone=auto";
        JSONObject f = new JSONObject(get(url, "application/json"));
        JSONObject m = f.optJSONObject("minutely_15");
        if (m == null || m.optJSONArray("time") == null || m.optJSONArray("precipitation") == null) return false;
        double[] o = rainStart(m.getJSONArray("time"), m.getJSONArray("precipitation"), now);
        double lead = clamp(rain.optDouble("leadMin", 30), 15, 60);
        if (o == null || o[0] > lead) return false;

        boolean es = Lang.spanish(cfg);
        JSONObject current = f.optJSONObject("current");
        double t = current == null ? Double.NaN : current.optDouble("temperature_2m", Double.NaN);
        int kind = Double.isNaN(t) ? 0 : t <= 0 ? 1 : t <= 2 ? 2 : 0; // 0 rain, 1 snow, 2 mix
        int intensity = o[2] < 0.6 ? 0 : o[2] < 2 ? 1 : 2;
        String[][] soonEn = {{"Rain starting in about {n} min", "Rain starting in a few minutes"}, {"Snow starting in about {n} min", "Snow starting in a few minutes"}, {"Rain or snow starting in about {n} min", "Rain or snow starting in a few minutes"}};
        String[][] soonEs = {{"Lluvia en unos {n} min", "Lluvia en pocos minutos"}, {"Nieve en unos {n} min", "Nieve en pocos minutos"}, {"Lluvia o nieve en unos {n} min", "Lluvia o nieve en pocos minutos"}};
        String[][] whatEn = {{"Light rain", "Moderate rain", "Heavy rain"}, {"Light snow", "Moderate snow", "Heavy snow"}, {"Light rain or snow", "Rain or snow", "Heavy rain or snow"}};
        String[][] whatEs = {{"Lluvia ligera", "Lluvia moderada", "Lluvia fuerte"}, {"Nieve ligera", "Nieve moderada", "Nieve fuerte"}, {"Lluvia o nieve ligera", "Lluvia o nieve", "Lluvia o nieve fuerte"}};
        String[] soon = (es ? soonEs : soonEn)[kind];
        String title = o[0] < 5 ? soon[1] : Lang.fill(soon[0], "n", roundMinutes(o[0]));
        String what = (es ? whatEs : whatEn)[kind][intensity];
        String body = o[1] < 0
                ? Lang.fill(Lang.pick(es, "{what} at {place}, lasting at least {h} hours.", "{what} en {place}, durante al menos {h} horas."),
                        "what", what, "place", place.name, "h", Math.max(1, Math.round((o[3] - o[0]) / 60)))
                : Lang.fill(Lang.pick(es, "{what} at {place}, lasting about {n} min.", "{what} en {place}, durante unos {n} min."),
                        "what", what, "place", place.name, "n", roundMinutes(Math.max(15, o[1] - o[0])));
        prefs.edit().putString(RAIN_AT, String.valueOf(now)).apply();
        long startAt = now + Math.round(o[0] * 60_000);
        return Notifier.show(ctx, id("rain:" + place.id + ":" + Math.round(startAt / 900_000.0)), Notifier.RAIN, title, body);
    }

    // ---- Storms heading your way -------------------------------------------

    private static final String[] COMPASS_EN = {"north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"};
    private static final String[] COMPASS_ES = {"el norte", "el noreste", "el este", "el sureste", "el sur", "el suroeste", "el oeste", "el noroeste"};

    /** For each place, the soonest strong storm due within the hour (from our server), announced once. */
    private static int checkStorms(Context ctx, JSONObject cfg, String server, List<Place> places, long now) throws Exception {
        JSONObject seen = readJson(ctx, STORMS_SEEN);
        boolean es = Lang.spanish(cfg);
        boolean mi = imperial(cfg);
        JSONObject units = cfg.optJSONObject("units");
        String windUnit = units == null ? "mph" : units.optString("wind", "mph");
        int sent = 0;
        for (Place p : places) {
            JSONArray storms = new JSONObject(get(server + "/api/storm-eta?lat=" + fmt(p.lat) + "&lon=" + fmt(p.lon), "application/json")).optJSONArray("storms");
            JSONObject s = storms == null ? null : storms.optJSONObject(0);
            if (s == null) continue;
            String key = p.id + ":" + str(s, "id");
            if (now - seen.optLong(key, 0) < STORM_REPEAT_MS) continue;
            seen.put(key, now);

            boolean tvs = !str(s, "tvs").isEmpty();
            int level = s.optInt("level", 0);
            double hail = s.isNull("maxHailIn") ? 0 : s.optDouble("maxHailIn", 0);
            boolean meso = !s.isNull("meso") && s.optInt("meso", 0) > 0;
            String titleEn;
            String titleEs;
            if (tvs) {
                titleEn = "Storm with rotation heading for {place}";
                titleEs = "Tormenta con rotación se dirige a {place}";
            } else if (meso && level >= 3) {
                titleEn = "Rotating storm heading for {place}";
                titleEs = "Tormenta rotatoria se dirige a {place}";
            } else if (hail >= 1 || level == 2) {
                titleEn = "Hailstorm heading for {place}";
                titleEs = "Tormenta con granizo se dirige a {place}";
            } else {
                titleEn = "Strong storm heading for {place}";
                titleEs = "Tormenta fuerte se dirige a {place}";
            }
            long arrives = s.optLong("arrivesAt", now);
            int eta = Math.max(1, s.optInt("etaMin", 1));
            StringBuilder body = new StringBuilder(Lang.fill(Lang.pick(es, "Arriving around {time} (in about {n} min).", "Llega cerca de las {time} (en unos {n} min)."),
                    "time", clock(arrives, es), "n", roundMinutes(eta)));
            if (hail >= 0.5) {
                String size = mi ? (Math.round(hail * 100) / 100.0) + " in" : Math.round(hail * 25.4) + " mm";
                body.append(" ").append(Lang.fill(Lang.pick(es, "Hail up to {size} possible.", "Posible granizo de hasta {size}."), "size", size));
            }
            double kt = s.optDouble("speedKt", 0);
            if (kt >= 3) {
                int i = (int) (Math.round(((s.optDouble("headingDeg", 0) % 360 + 360) % 360) / 45) % 8);
                body.append(" ").append(Lang.fill(Lang.pick(es, "Moving {dir} at {speed}.", "Se mueve hacia {dir} a {speed}."),
                        "dir", es ? COMPASS_ES[i] : COMPASS_EN[i], "speed", windText(kt * 1.852, windUnit)));
            }
            if (tvs) body.append(" ").append(Lang.pick(es, "Watch for a tornado warning and be ready to take shelter.", "Esté atento a un aviso de tornado y listo para refugiarse."));
            if (Notifier.show(ctx, id("storm:" + key), Notifier.STORMS, Lang.fill(Lang.pick(es, titleEn, titleEs), "place", p.name), body.toString())) sent++;
        }
        Iterator<String> it = seen.keys();
        List<String> stale = new ArrayList<>();
        while (it.hasNext()) {
            String k = it.next();
            if (now - seen.optLong(k, 0) > 6 * HOUR) stale.add(k);
        }
        for (String k : stale) seen.remove(k);
        writeJson(ctx, STORMS_SEEN, seen);
        return sent;
    }

    // ---- Activity on your reports ------------------------------------------

    /** Confirmations and comments since the last check, using the sign-in cookie the app's web view holds. */
    private static int checkActivity(Context ctx, JSONObject cfg, String base, long now) throws Exception {
        SharedPreferences prefs = prefs(ctx);
        String raw = prefs.getString(ACTIVITY_SINCE, "");
        if (raw.isEmpty()) {
            // First run: start from now instead of announcing old activity.
            prefs.edit().putString(ACTIVITY_SINCE, String.valueOf(now)).apply();
            return 0;
        }
        long since;
        try {
            since = Long.parseLong(raw);
        } catch (Exception e) {
            since = now;
        }
        String cookie = null;
        try {
            cookie = CookieManager.getInstance().getCookie(base);
        } catch (Exception ignored) {
            // No web view data yet.
        }
        if (cookie == null || cookie.isEmpty()) return 0;
        JSONArray items = new JSONObject(getWithCookie(base + "/api/activity?since=" + since, cookie)).optJSONArray("items");
        if (items == null) return 0;
        boolean es = Lang.spanish(cfg);
        long latest = since;
        int sent = 0;
        for (int i = 0; i < items.length(); i++) latest = Math.max(latest, items.optJSONObject(i) == null ? 0 : items.optJSONObject(i).optLong("at", 0));
        prefs.edit().putString(ACTIVITY_SINCE, String.valueOf(latest)).apply();
        if (items.length() > 5) {
            String title = Lang.fill(items.length() == 1 ? Lang.pick(es, "{n} new reaction to your reports", "{n} nueva reacción a tus reportes")
                    : Lang.pick(es, "{n} new reactions to your reports", "{n} nuevas reacciones a tus reportes"), "n", items.length());
            return Notifier.show(ctx, id("activity:batch:" + latest), Notifier.ACTIVITY, title,
                    Lang.pick(es, "Open Storm Central to see who confirmed or commented.", "Abre Storm Central para ver quién confirmó o comentó.")) ? 1 : 0;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject a = items.optJSONObject(i);
            if (a == null) continue;
            JSONObject actor = a.optJSONObject("actor");
            String who = str(actor, "displayName").isEmpty() ? str(actor, "username") : str(actor, "displayName");
            String title;
            String body;
            if ("confirm".equals(str(a, "kind"))) {
                title = Lang.fill(Lang.pick(es, "{who} confirmed your report", "{who} confirmó tu reporte"), "who", who);
                String what = str(a, "postPreview");
                if (what.length() > 60) what = what.substring(0, 57) + "…";
                body = what.isEmpty() ? Lang.pick(es, "Your report is being confirmed by spotters nearby.", "Observadores cercanos están confirmando tu reporte.") : "“" + what + "”";
            } else {
                title = Lang.fill(Lang.pick(es, "{who} commented on your report", "{who} comentó tu reporte"), "who", who);
                body = str(a, "text").replaceAll("\\s+", " ").trim();
                if (body.length() > 140) body = body.substring(0, 137) + "…";
            }
            if (Notifier.show(ctx, id("activity:" + str(a, "id")), Notifier.ACTIVITY, title, body)) sent++;
        }
        return sent;
    }

    // ---- Helpers ------------------------------------------------------------

    /** A string field, or "" when missing or JSON null (optString would return the text "null"). */
    static String str(JSONObject o, String key) {
        return o == null || o.isNull(key) ? "" : o.optString(key, "");
    }

    /** "4:05 PM" / "4:05 p. m." on the phone's clock. */
    static String clock(long ms, boolean es) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        int h = c.get(Calendar.HOUR_OF_DAY);
        return String.format(Locale.US, "%d:%02d %s", h % 12 == 0 ? 12 : h % 12, c.get(Calendar.MINUTE), Lang.ampm(es, h < 12));
    }

    /** "https://site" without a trailing slash, or null for anything but HTTPS (or the local test server). */
    static String cleanBase(String url) {
        String base = url == null ? "" : url.replaceAll("/+$", "");
        return base.startsWith("https://") || base.startsWith("http://127.0.0.1") ? base : null;
    }

    /** Storm Central's own server from the config, or null. */
    private static String serverBase(JSONObject cfg) {
        return cfg.isNull("server") ? null : cleanBase(cfg.optString("server", ""));
    }

    /** "About 25 min" rounding: exact under 10, then to 5 minutes (lib/weather/rain-outlook.ts roundMinutes). */
    static long roundMinutes(double m) {
        return m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5;
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

    /** A JSON GET that sends the given Cookie header (our own server only). */
    private static String getWithCookie(String url, String cookie) throws IOException {
        return new String(getBytes(url, "application/json", cookie), "UTF-8");
    }

    static byte[] getBytes(String url, String accept) throws IOException {
        return getBytes(url, accept, null);
    }

    private static byte[] getBytes(String url, String accept, String cookie) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(TIMEOUT_MS);
        c.setReadTimeout(TIMEOUT_MS);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", accept);
        if (cookie != null) c.setRequestProperty("Cookie", cookie);
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
