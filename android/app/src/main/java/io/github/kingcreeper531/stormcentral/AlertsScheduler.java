package io.github.kingcreeper531.stormcentral;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Schedules {@link AlertsWorker} with WorkManager, which survives the app
 * being closed or swiped away, phone restarts and app updates:
 *
 * <ul>
 *   <li>every 15 minutes (Android's shortest repeat), when online;</li>
 *   <li>once at the morning-briefing time, so it isn't up to 15 minutes late;</li>
 *   <li>right away when the app asks (it came to the front, or settings changed).</li>
 * </ul>
 */
final class AlertsScheduler {

    private static final String PERIODIC = "stormcentral-alerts";
    private static final String NOW = "stormcentral-alerts-now";
    static final String BRIEFING_TAG = "stormcentral-briefing";

    private AlertsScheduler() {}

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** Makes sure the 15-minute check is scheduled (keeps an existing schedule). */
    static void ensure(Context ctx) {
        // Tells the background runner (shared storage, strings only) that warnings are handled natively.
        AlertsWorker.prefs(ctx).edit().putString("nativeAlerts", "1").apply();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(AlertsWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(online())
                .build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    /** Checks now (as soon as there's a network). */
    static void runNow(Context ctx) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(AlertsWorker.class).setConstraints(online()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req);
    }

    /** (Re)schedules the next morning briefing from the saved settings, or cancels it when it's off. */
    static void scheduleBriefing(Context ctx, boolean replace) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (replace) wm.cancelAllWorkByTag(BRIEFING_TAG);
        JSONObject cfg = AlertsWorker.readConfig(ctx);
        JSONObject settings = cfg == null ? null : cfg.optJSONObject("settings");
        JSONObject briefing = settings == null ? null : settings.optJSONObject("briefing");
        if (briefing == null || !briefing.optBoolean("enabled", false) || !settings.optBoolean("enabled", false)) return;

        long now = System.currentTimeMillis();
        long at = AlertsWorker.briefingAt(briefing, now);
        // A few seconds past the minute, so the worker sees the time as reached.
        if (at + 5_000 <= now) at = AlertsWorker.briefingAt(briefing, now + 24 * 3_600_000L);
        long delay = Math.max(0, at + 5_000 - now);
        String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(at));
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(AlertsWorker.class)
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setConstraints(online())
                .addTag(BRIEFING_TAG)
                .build();
        wm.enqueueUniqueWork("stormcentral-briefing-" + day, ExistingWorkPolicy.REPLACE, req);
    }
}
