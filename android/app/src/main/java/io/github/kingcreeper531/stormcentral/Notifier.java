package io.github.kingcreeper531.stormcentral;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Posts Storm Central's notifications straight through Android's
 * NotificationManager, with one channel per kind so each can be tuned (or
 * silenced) in the system settings. Used by {@link AlertsWorker} whether the
 * app is open or closed, so there is a single, native delivery path.
 */
final class Notifier {

    static final String WARNINGS = "sc_warnings";
    static final String LIGHTNING = "sc_lightning";
    static final String SPOTTER = "sc_spotter";
    static final String BRIEFING = "sc_briefing";
    static final String ALERTS = "sc_alerts";
    static final String RAIN = "sc_rain";
    static final String STORMS = "sc_storms";
    static final String ACTIVITY = "sc_activity";

    private static final int ACCENT = 0xFF5B9CF6;

    private Notifier() {}

    /** Creates the channels (idempotent; Android keeps the user's changes to existing channels). */
    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        // Names follow the app's language (Android keeps the user's sound and importance choices).
        boolean es = Lang.spanish(context);
        nm.createNotificationChannel(channel(WARNINGS, Lang.pick(es, "Weather warnings", "Avisos meteorológicos"), Lang.pick(es, "NWS warnings for your places", "Avisos del NWS para tus lugares"), NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(STORMS, Lang.pick(es, "Storms heading your way", "Tormentas que se acercan"), Lang.pick(es, "Strong storms on radar due to reach your places", "Tormentas fuertes en el radar que llegarán a tus lugares"), NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(LIGHTNING, Lang.pick(es, "Lightning nearby", "Rayos cerca"), Lang.pick(es, "Lightning detected near your places", "Rayos detectados cerca de tus lugares"), NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(channel(RAIN, Lang.pick(es, "Rain starting soon", "Lluvia en camino"), Lang.pick(es, "Rain or snow about to start where you are", "Lluvia o nieve a punto de empezar donde estás"), NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(channel(SPOTTER, Lang.pick(es, "Nearby spotter reports", "Reportes de observadores cercanos"), Lang.pick(es, "Severe weather reported by spotters near you", "Tiempo severo reportado por observadores cerca de ti"), NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(channel(ACTIVITY, Lang.pick(es, "Activity on your reports", "Actividad en tus reportes"), Lang.pick(es, "Confirmations and comments on reports you posted", "Confirmaciones y comentarios en tus reportes"), NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(channel(BRIEFING, Lang.pick(es, "Morning briefing", "Resumen matutino"), Lang.pick(es, "Your daily forecast summary", "Tu resumen diario del pronóstico"), NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(channel(ALERTS, Lang.pick(es, "Custom alerts", "Alertas personalizadas"), Lang.pick(es, "Your custom weather alerts and tests", "Tus alertas personalizadas y pruebas"), NotificationManager.IMPORTANCE_DEFAULT));
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private static NotificationChannel channel(String id, String name, String description, int importance) {
        NotificationChannel c = new NotificationChannel(id, name, importance);
        c.setDescription(description);
        c.enableVibration(importance >= NotificationManager.IMPORTANCE_HIGH);
        c.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        return c;
    }

    /** Whether Android will show our notifications at all (permission granted and not switched off). */
    static boolean allowed(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /** Shows a notification that opens the app; returns false when Android won't allow it. */
    static boolean show(Context context, int id, String channel, String title, String body) {
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return showWithIntent(context, id, channel, title, body, tap);
    }

    /** Shows a notification with its own tap action. */
    static boolean showWithIntent(Context context, int id, String channel, String title, String body, PendingIntent tap) {
        ensureChannels(context);
        if (!allowed(context)) return false;

        boolean urgent = WARNINGS.equals(channel) || LIGHTNING.equals(channel) || STORMS.equals(channel);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_stormcentral)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setCategory(urgent ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(urgent ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setGroup(channel);
        try {
            NotificationManagerCompat.from(context).notify(id, b.build());
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }
}
