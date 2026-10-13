package io.github.kingcreeper531.stormcentral;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Runs after StormCentral is updated (MY_PACKAGE_REPLACED, sent only by the
 * system to the updated app): keeps the background checks scheduled and says
 * the update is done, since an update closes the app.
 */
public class PackageReplacedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        AlertsScheduler.ensure(ctx);
        AlertsScheduler.scheduleBriefing(ctx, true);
        UpdateScheduler.ensure(ctx);
        boolean ours = "installing".equals(AppUpdater.prefs(ctx).getString(AppUpdater.PREF_STATE, ""))
                || "confirm".equals(AppUpdater.prefs(ctx).getString(AppUpdater.PREF_STATE, ""));
        AppUpdater.prefs(ctx).edit().putString(AppUpdater.PREF_STATE, "installed").apply();
        if (ours) {
            Notifier.show(ctx, AlertsWorker.id("updated"), Notifier.ALERTS, "StormCentral updated",
                    "You're on version " + AppUpdater.installedVersion(ctx) + ". Tap to open.");
        }
    }
}
