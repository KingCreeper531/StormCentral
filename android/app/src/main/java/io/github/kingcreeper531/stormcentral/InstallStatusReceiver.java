package io.github.kingcreeper531.stormcentral;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/**
 * Results of an update install (not exported: only our own PackageInstaller
 * session's PendingIntent reaches it). When Android wants the person to
 * confirm, opens the confirmation screen, or posts a notification for it
 * when the update was started in the background.
 */
public class InstallStatusReceiver extends BroadcastReceiver {

    static final String EXTRA_INTERACTIVE = "interactive";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : legacyIntent(intent);
            if (confirm == null) return;
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            AppUpdater.prefs(ctx).edit().putString(AppUpdater.PREF_STATE, "confirm").apply();
            if (intent.getBooleanExtra(EXTRA_INTERACTIVE, false) && MainActivity.inForeground) {
                ctx.startActivity(confirm);
            } else {
                PendingIntent tap = PendingIntent.getActivity(ctx, 7, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notifier.showWithIntent(ctx, AlertsWorker.id("update-ready"), Notifier.ALERTS,
                        "StormCentral update ready", "Tap to install the new version. Your settings stay.", tap);
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            AppUpdater.prefs(ctx).edit().putString(AppUpdater.PREF_STATE, "installed").remove(AppUpdater.PREF_ERROR).apply();
        } else {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            AppUpdater.fail(ctx, status == PackageInstaller.STATUS_FAILURE_ABORTED ? "The update was cancelled." : "The update couldn't be installed" + (msg != null ? " (" + msg + ")." : "."));
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyIntent(Intent intent) {
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
