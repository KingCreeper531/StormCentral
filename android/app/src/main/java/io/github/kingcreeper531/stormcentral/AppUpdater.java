package io.github.kingcreeper531.stormcentral;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates, like an app store: downloads the newest release's APK from
 * GitHub and installs it through a PackageInstaller session.
 *
 * <p>Android asks the person to confirm the first update (the app was
 * installed by a browser or file manager). Once StormCentral has installed
 * itself, Android 12+ lets later updates go through without asking
 * ({@code USER_ACTION_NOT_REQUIRED}; on Android 14+ with the
 * UPDATE_PACKAGES_WITHOUT_USER_ACTION permission). Android only accepts an
 * update signed with the same key, so a tampered APK can't be installed.
 */
final class AppUpdater {

    static final String REPO = "KingCreeper531/StormCentral";
    static final String PREF_AUTO = "autoUpdate";
    static final String PREF_ERROR = "updateError";
    static final String PREF_STATE = "updateState";

    interface Progress {
        void onProgress(int percent);
    }

    static final class Release {
        final String version;
        final String apkUrl;

        Release(String version, String apkUrl) {
            this.version = version;
            this.apkUrl = apkUrl;
        }
    }

    private AppUpdater() {}

    static SharedPreferences prefs(Context ctx) {
        return AlertsWorker.prefs(ctx);
    }

    /** The newest GitHub release with an APK, or null. */
    static Release latest() throws Exception {
        JSONObject rel = new JSONObject(AlertsWorker.get("https://api.github.com/repos/" + REPO + "/releases/latest", "application/vnd.github+json"));
        String tag = AlertsWorker.str(rel, "tag_name").replaceFirst("^v", "");
        JSONArray assets = rel.optJSONArray("assets");
        if (tag.isEmpty() || assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a != null && AlertsWorker.str(a, "name").toLowerCase().endsWith(".apk")) {
                return new Release(tag, AlertsWorker.str(a, "browser_download_url"));
            }
        }
        return null;
    }

    static long installedCode(Context ctx) throws PackageManager.NameNotFoundException {
        PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    static String installedVersion(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    /** "0.4.3" → 4003, matching versionCode in app/build.gradle. */
    static long codeFor(String version) {
        String[] p = version.split("-")[0].split("\\.");
        long code = 0;
        long[] scale = {1_000_000L, 1_000L, 1L};
        for (int i = 0; i < 3 && i < p.length; i++) {
            try {
                code += Long.parseLong(p[i]) * scale[i];
            } catch (NumberFormatException ignored) {
                return -1;
            }
        }
        return code;
    }

    static boolean isNewer(Context ctx, Release r) {
        try {
            return r != null && codeFor(r.version) > installedCode(ctx);
        } catch (Exception e) {
            return false;
        }
    }

    /** Whether the person has let StormCentral install apps (Android 8+ asks once). */
    static boolean canInstall(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.getPackageManager().canRequestPackageInstalls();
    }

    /** Whether Android will install our updates without a confirmation screen. */
    static boolean silentPossible(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
        try {
            String installer = ctx.getPackageManager().getInstallSourceInfo(ctx.getPackageName()).getInstallingPackageName();
            return ctx.getPackageName().equals(installer);
        } catch (Exception e) {
            return false;
        }
    }

    /** Downloads the APK into the app's cache, reporting progress. */
    static File download(Context ctx, Release r, Progress progress) throws IOException {
        if (!r.apkUrl.startsWith("https://github.com/") && !r.apkUrl.startsWith("https://objects.githubusercontent.com/")) {
            throw new IOException("unexpected download address");
        }
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no cache directory");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        File out = new File(dir, "StormCentral-" + r.version.replaceAll("[^0-9A-Za-z.-]", "") + ".apk");

        HttpURLConnection c = (HttpURLConnection) new URL(r.apkUrl).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(20_000);
        c.setReadTimeout(30_000);
        c.setRequestProperty("User-Agent", "StormCentral-Updater");
        try {
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("download failed (HTTP " + code + ")");
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                long done = 0;
                int last = -1;
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    done += n;
                    if (done > 300L * 1024 * 1024) throw new IOException("download too large");
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    if (pct != last && progress != null) progress.onProgress(pct);
                    last = pct;
                }
            }
        } finally {
            c.disconnect();
        }
        return out;
    }

    /** Checks the file is a newer StormCentral before handing it to Android. */
    static void verify(Context ctx, File apk) throws IOException {
        PackageManager pm = ctx.getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null) throw new IOException("the download isn't a valid app");
        if (!ctx.getPackageName().equals(info.packageName)) throw new IOException("the download isn't StormCentral");
        long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        try {
            if (code <= installedCode(ctx)) throw new IOException("the download isn't newer than this version");
        } catch (PackageManager.NameNotFoundException e) {
            throw new IOException(e.getMessage());
        }
    }

    /**
     * Starts the install. `interactive`: the person tapped Update, so a
     * confirmation screen can open straight away; otherwise (automatic
     * updates) a notification asks them to tap.
     */
    static void install(Context ctx, File apk, boolean interactive) throws IOException {
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(ctx, InstallStatusReceiver.class).putExtra(InstallStatusReceiver.EXTRA_INTERACTIVE, interactive);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, sessionId, status, flags);
            prefs(ctx).edit().putString(PREF_STATE, "installing").remove(PREF_ERROR).apply();
            session.commit(pi.getIntentSender());
        } catch (IOException | RuntimeException e) {
            installer.abandonSession(sessionId);
            throw e instanceof IOException ? (IOException) e : new IOException(e.getMessage());
        }
    }

    static void fail(Context ctx, String message) {
        prefs(ctx).edit().putString(PREF_STATE, "failed").putString(PREF_ERROR, message).apply();
    }
}
