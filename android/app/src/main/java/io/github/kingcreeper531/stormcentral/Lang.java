package io.github.kingcreeper531.stormcentral;

import android.content.Context;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Notification language for the native side: the app's choice, saved in the
 * page's config ({@code lang}, see lib/alerting/types.ts), else the phone's.
 * Wording matches src/lib/i18n/es/notify.ts.
 */
final class Lang {

    private Lang() {}

    /** True when notifications should be in Spanish. */
    static boolean spanish(Context ctx) {
        JSONObject cfg = AlertsWorker.readConfig(ctx);
        return spanish(cfg);
    }

    static boolean spanish(JSONObject cfg) {
        String lang = cfg == null ? "" : AlertsWorker.str(cfg, "lang");
        if (lang.isEmpty()) lang = Locale.getDefault().getLanguage();
        return lang.startsWith("es");
    }

    /** {@code pick(es, "Lightning near {place}", "Rayos cerca de {place}")} */
    static String pick(boolean es, String en, String spanish) {
        return es ? spanish : en;
    }

    /** Fills {name} placeholders: fill("Hoy en {place}", "place", name). */
    static String fill(String template, Object... pairs) {
        String s = template;
        for (int i = 0; i + 1 < pairs.length; i += 2) s = s.replace("{" + pairs[i] + "}", String.valueOf(pairs[i + 1]));
        return s;
    }

    /** "3:30 PM" or "3:30 p. m." */
    static String ampm(boolean es, boolean am) {
        return es ? (am ? "a. m." : "p. m.") : (am ? "AM" : "PM");
    }

    private static final Map<String, String> EVENTS = new HashMap<>();

    static {
        // NWS's own Spanish terms: Warning = Aviso, Watch = Vigilancia, Advisory = Advertencia. Keep in step with src/lib/i18n/nws-events.ts.
        String[][] pairs = {
                {"Tornado Warning", "Aviso de tornado"},
                {"Tornado Watch", "Vigilancia de tornado"},
                {"Tornado Emergency", "Emergencia de tornado"},
                {"Severe Thunderstorm Warning", "Aviso de tormenta eléctrica severa"},
                {"Severe Thunderstorm Watch", "Vigilancia de tormenta eléctrica severa"},
                {"Flash Flood Warning", "Aviso de inundación repentina"},
                {"Flash Flood Watch", "Vigilancia de inundación repentina"},
                {"Flash Flood Emergency", "Emergencia de inundación repentina"},
                {"Flood Warning", "Aviso de inundación"},
                {"Flood Watch", "Vigilancia de inundación"},
                {"Flood Advisory", "Advertencia de inundación"},
                {"Coastal Flood Warning", "Aviso de inundación costera"},
                {"Coastal Flood Advisory", "Advertencia de inundación costera"},
                {"Hurricane Warning", "Aviso de huracán"},
                {"Hurricane Watch", "Vigilancia de huracán"},
                {"Tropical Storm Warning", "Aviso de tormenta tropical"},
                {"Tropical Storm Watch", "Vigilancia de tormenta tropical"},
                {"Storm Surge Warning", "Aviso de marejada ciclónica"},
                {"Storm Surge Watch", "Vigilancia de marejada ciclónica"},
                {"Winter Storm Warning", "Aviso de tormenta invernal"},
                {"Winter Storm Watch", "Vigilancia de tormenta invernal"},
                {"Winter Weather Advisory", "Advertencia de tiempo invernal"},
                {"Blizzard Warning", "Aviso de ventisca"},
                {"Ice Storm Warning", "Aviso de tormenta de hielo"},
                {"Extreme Cold Warning", "Aviso de frío extremo"},
                {"Cold Weather Advisory", "Advertencia de tiempo frío"},
                {"Wind Chill Warning", "Aviso de sensación térmica"},
                {"Wind Chill Advisory", "Advertencia de sensación térmica"},
                {"Freeze Warning", "Aviso de congelación"},
                {"Frost Advisory", "Advertencia de escarcha"},
                {"Excessive Heat Warning", "Aviso de calor excesivo"},
                {"Extreme Heat Warning", "Aviso de calor extremo"},
                {"Heat Advisory", "Advertencia de calor"},
                {"High Wind Warning", "Aviso de vientos fuertes"},
                {"High Wind Watch", "Vigilancia de vientos fuertes"},
                {"Wind Advisory", "Advertencia de viento"},
                {"Extreme Wind Warning", "Aviso de vientos extremos"},
                {"Red Flag Warning", "Aviso de bandera roja"},
                {"Fire Weather Watch", "Vigilancia de tiempo de incendios"},
                {"Dense Fog Advisory", "Advertencia de niebla densa"},
                {"Dust Storm Warning", "Aviso de tormenta de polvo"},
                {"Air Quality Alert", "Alerta de calidad del aire"},
                {"Special Weather Statement", "Declaración especial del tiempo"},
                {"Severe Weather Statement", "Declaración de tiempo severo"},
                {"Small Craft Advisory", "Advertencia para embarcaciones pequeñas"},
                {"Gale Warning", "Aviso de vendaval"},
                {"Beach Hazards Statement", "Declaración de peligros en la playa"},
                {"Rip Current Statement", "Declaración de corrientes de resaca"},
        };
        for (String[] p : pairs) EVENTS.put(p[0], p[1]);
    }

    /** An NWS event name in Spanish when we know it, else as sent. */
    static String event(boolean es, String event) {
        if (!es) return event;
        String t = EVENTS.get(event);
        return t == null ? event : t;
    }
}
