package io.github.kingcreeper531.stormcentral;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/** The page's handle on in-app updates (src/lib/native/app-updater.ts). */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("canInstall", AppUpdater.canInstall(ctx));
        r.put("silent", AppUpdater.silentPossible(ctx));
        r.put("auto", !"0".equals(AppUpdater.prefs(ctx).getString(AppUpdater.PREF_AUTO, "1")));
        r.put("state", AppUpdater.prefs(ctx).getString(AppUpdater.PREF_STATE, null));
        r.put("error", AppUpdater.prefs(ctx).getString(AppUpdater.PREF_ERROR, null));
        call.resolve(r);
    }

    @PluginMethod
    public void setAuto(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        AppUpdater.prefs(getContext()).edit().putString(AppUpdater.PREF_AUTO, on ? "1" : "0").apply();
        call.resolve();
    }

    /** Opens "Install unknown apps" for Storm Central (Android 8+ asks once). */
    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        Context ctx = getContext();
        Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()))
                : new Intent(Settings.ACTION_SECURITY_SETTINGS);
        ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    /** Downloads the newest release (progress events: "progress" {percent}) and starts installing it. */
    @PluginMethod
    public void install(PluginCall call) {
        Context ctx = getContext();
        if (!AppUpdater.canInstall(ctx)) {
            call.reject("Allow Storm Central to install apps first.", "PERMISSION");
            return;
        }
        new Thread(() -> {
            try {
                AppUpdater.prefs(ctx).edit().putString(AppUpdater.PREF_STATE, "downloading").remove(AppUpdater.PREF_ERROR).apply();
                AppUpdater.Release r = AppUpdater.latest();
                if (!AppUpdater.isNewer(ctx, r)) {
                    AppUpdater.prefs(ctx).edit().remove(AppUpdater.PREF_STATE).apply();
                    call.reject("You already have the latest version.", "CURRENT");
                    return;
                }
                File apk = AppUpdater.download(ctx, r, (pct) -> {
                    JSObject p = new JSObject();
                    p.put("percent", pct);
                    notifyListeners("progress", p);
                });
                AppUpdater.verify(ctx, apk);
                AppUpdater.install(ctx, apk, true);
                JSObject res = new JSObject();
                res.put("version", r.version);
                res.put("silent", AppUpdater.silentPossible(ctx));
                call.resolve(res);
            } catch (Exception e) {
                AppUpdater.fail(ctx, e.getMessage());
                call.reject(e.getMessage() == null ? "The update failed." : e.getMessage(), "FAILED");
            }
        }, "stormcentral-update").start();
    }
}
