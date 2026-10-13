package io.github.kingcreeper531.stormcentral;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.File;

/**
 * Automatic updates (Settings → App → Install updates automatically, on by
 * default): when a newer release is out and the app isn't on screen,
 * downloads and installs it. Where Android allows (StormCentral installed
 * itself before, Android 12+) it installs without asking and the person sees
 * an "updated" notification; otherwise a notification asks them to tap to
 * install. With automatic updates off, a notification says one is available.
 */
public final class UpdateWorker extends Worker {

    public UpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        try {
            AppUpdater.Release r = AppUpdater.latest();
            if (!AppUpdater.isNewer(ctx, r)) return Result.success();
            boolean auto = !"0".equals(AppUpdater.prefs(ctx).getString(AppUpdater.PREF_AUTO, "1"));
            String announced = AppUpdater.prefs(ctx).getString("updateAnnounced", "");
            if (!auto || !AppUpdater.canInstall(ctx)) {
                if (!r.version.equals(announced)) {
                    AppUpdater.prefs(ctx).edit().putString("updateAnnounced", r.version).apply();
                    Notifier.show(ctx, AlertsWorker.id("update-available"), Notifier.ALERTS, "StormCentral " + r.version + " is available",
                            "Open StormCentral and tap Update to install it.");
                }
                return Result.success();
            }
            // Don't close the app under someone using it; try again next time.
            if (MainActivity.inForeground) return Result.success();
            File apk = AppUpdater.download(ctx, r, null);
            AppUpdater.verify(ctx, apk);
            AppUpdater.install(ctx, apk, false);
        } catch (Exception e) {
            AppUpdater.fail(ctx, "Automatic update failed: " + e.getMessage());
        }
        return Result.success();
    }
}
