package io.github.kingcreeper531.stormcentral;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page's handle on native notifications (src/lib/native/storm-alerts.ts):
 * schedule and run checks, send a test, and report whether anything (the
 * permission, battery restrictions) is in the way.
 */
@CapacitorPlugin(name = "StormAlerts")
public class StormAlertsPlugin extends Plugin {

    /** Settings changed: keep the schedule, re-plan the briefing, and check now. */
    @PluginMethod
    public void sync(PluginCall call) {
        Context ctx = getContext();
        Notifier.ensureChannels(ctx);
        AlertsScheduler.ensure(ctx);
        AlertsScheduler.scheduleBriefing(ctx, true);
        AlertsScheduler.runNow(ctx);
        call.resolve();
    }

    @PluginMethod
    public void checkNow(PluginCall call) {
        AlertsScheduler.runNow(getContext());
        call.resolve();
    }

    @PluginMethod
    public void test(PluginCall call) {
        boolean shown = Notifier.show(getContext(), 1, Notifier.WARNINGS, "Storm Central notifications are working",
                "Warnings, lightning and nearby reports for your places will look like this, even when the app is closed.");
        JSObject r = new JSObject();
        r.put("shown", shown);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("allowed", Notifier.allowed(ctx));
        r.put("batteryUnrestricted", batteryUnrestricted(ctx));
        long last = AlertsWorker.lastRun(ctx);
        r.put("lastRun", last == 0 ? null : last);
        r.put("lastResult", AlertsWorker.prefs(ctx).getString(AlertsWorker.LAST_RESULT, null));
        call.resolve(r);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        // The per-app notification screen exists from Android 8; before that, the app's info screen.
        Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Asks Android to stop battery optimization from delaying the checks. */
    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            ctx.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    private static boolean batteryUnrestricted(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }
}
