package io.github.kingcreeper531.stormcentral;

import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.nothing.ketchum.Common;
import com.nothing.ketchum.Glyph;
import com.nothing.ketchum.GlyphFrame;
import com.nothing.ketchum.GlyphManager;

/**
 * Glyph lights on the back of Nothing Phone (1), (2), (2a), (2a) Plus and (3a):
 * a breathing flash when a weather warning is posted while Storm Central is on
 * screen (Nothing lets only the app in the foreground drive the lights; with the
 * app closed, the phone's own Glyph notifications do it). Tornado and other
 * life-threatening warnings flash faster and longer. Phone (3) has the Glyph
 * Matrix instead: see WeatherGlyphToy.
 */
final class GlyphLights {

    private static final String TAG = "StormCentralGlyph";

    private GlyphLights() {}

    /** Called with every warning notification; does nothing unless the app is on screen on a Nothing phone. */
    static void warningPosted(Context context, boolean urgent) {
        if (!MainActivity.inForeground || Build.VERSION.SDK_INT < 34 || !"Nothing".equalsIgnoreCase(Build.MANUFACTURER)) return;
        Context app = context.getApplicationContext();
        new Handler(Looper.getMainLooper()).post(() -> flash(app, urgent));
    }

    private static void flash(Context app, boolean urgent) {
        final GlyphManager manager;
        try {
            manager = GlyphManager.getInstance(app);
        } catch (Exception e) {
            return;
        }
        if (manager == null) return;
        final Handler main = new Handler(Looper.getMainLooper());
        final int period = urgent ? 600 : 1200;
        final int cycles = urgent ? 6 : 3;
        final int interval = urgent ? 100 : 300;
        try {
            manager.init(new GlyphManager.Callback() {
                @Override
                public void onServiceConnected(ComponentName name) {
                    String device = device();
                    if (device == null) {
                        finish(manager);
                        return;
                    }
                    try {
                        manager.register(device);
                        manager.openSession();
                        GlyphFrame frame = manager.getGlyphFrameBuilder()
                                .buildChannelA()
                                .buildChannelB()
                                .buildChannelC()
                                .buildPeriod(period)
                                .buildCycles(cycles)
                                .buildInterval(interval)
                                .build();
                        manager.animate(frame);
                        main.postDelayed(() -> finish(manager), (long) (period + interval) * cycles + 1000);
                    } catch (Exception e) {
                        Log.w(TAG, "Glyph flash failed", e);
                        finish(manager);
                    }
                }

                @Override
                public void onServiceDisconnected(ComponentName name) {}
            });
        } catch (Exception e) {
            Log.w(TAG, "Glyph lights unavailable", e);
        }
    }

    private static void finish(GlyphManager manager) {
        try {
            manager.turnOff();
        } catch (Exception ignored) {
            // Already off.
        }
        try {
            manager.closeSession();
        } catch (Exception ignored) {
            // No session open.
        }
        try {
            manager.unInit();
        } catch (Exception ignored) {
            // Already unbound.
        }
    }

    /** The SDK's name for this phone, or null when it has no Glyph lights the SDK knows (Phone (3) has the matrix). */
    private static String device() {
        if (Common.is20111()) return Glyph.DEVICE_20111;
        if (Common.is22111()) return Glyph.DEVICE_22111;
        if (Common.is23111()) return Glyph.DEVICE_23111;
        if (Common.is23113()) return Glyph.DEVICE_23113;
        if (Common.is24111()) return Glyph.DEVICE_24111;
        return null;
    }
}
