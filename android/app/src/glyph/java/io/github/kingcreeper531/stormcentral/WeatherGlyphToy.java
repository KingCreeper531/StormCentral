package io.github.kingcreeper531.stormcentral;

import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.util.Log;

import com.nothing.ketchum.Glyph;
import com.nothing.ketchum.GlyphMatrixManager;
import com.nothing.ketchum.GlyphToy;

import io.github.kingcreeper531.stormcentral.glyph.GlyphArt;

import org.json.JSONObject;

/**
 * The Storm Central Glyph Toy for the Glyph Matrix on the back of Nothing Phone (3):
 * the weather icon (a warning triangle while a warning is in effect) over the
 * temperature, from the same snapshot as the home-screen widgets. A long press on
 * the Glyph Button switches to today's high and low. As the always-on toy it
 * redraws every minute and fetches a new forecast when the snapshot is stale.
 * Built with Nothing's Glyph Matrix SDK (com.nothing.ketchum), which the
 * release build downloads (scripts/build-native.mjs); src/noglyph has a no-op
 * stand-in for builds without it.
 */
public class WeatherGlyphToy extends Service {

    private static final String TAG = "StormCentralGlyph";
    /** The bundle key the Glyph Toy events arrive under (as in Nothing's example project). */
    private static final String KEY_DATA = "data";

    /** Whether the toy is on the matrix, so the widget refresh keeps its snapshot fresh too. */
    static volatile boolean active = false;

    private GlyphMatrixManager manager;
    private int view = 0;

    private final Handler handler = new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message msg) {
            if (msg.what != GlyphToy.MSG_GLYPH_TOY) {
                super.handleMessage(msg);
                return;
            }
            Bundle data = msg.getData();
            String event = data == null ? null : data.getString(KEY_DATA);
            if (GlyphToy.EVENT_CHANGE.equals(event)) {
                view = (view + 1) % 2;
                draw();
            } else if (GlyphToy.EVENT_AOD.equals(event)) {
                draw();
                refreshIfStale();
            }
        }
    };
    private final Messenger messenger = new Messenger(handler);

    private final GlyphMatrixManager.Callback callback = new GlyphMatrixManager.Callback() {
        @Override
        public void onServiceConnected(ComponentName name) {
            if (manager == null) return;
            try {
                manager.register(Glyph.DEVICE_23112);
            } catch (Exception e) {
                Log.w(TAG, "Glyph Matrix register failed", e);
                return;
            }
            draw();
            refreshIfStale();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {}
    };

    @Override
    public IBinder onBind(Intent intent) {
        active = true;
        view = 0;
        try {
            manager = GlyphMatrixManager.getInstance(getApplicationContext());
            if (manager != null) manager.init(callback);
        } catch (Exception e) {
            Log.w(TAG, "Glyph Matrix unavailable", e);
            manager = null;
        }
        return messenger.getBinder();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        active = false;
        if (manager != null) {
            try {
                manager.turnOff();
            } catch (Exception ignored) {
                // Already off.
            }
            try {
                manager.unInit();
            } catch (Exception ignored) {
                // Already unbound.
            }
            manager = null;
        }
        return false;
    }

    private void draw() {
        if (manager == null) return;
        Context app = getApplicationContext();
        try {
            manager.setMatrixFrame(GlyphArt.render(info(app, WeatherWidgetData.read(app), System.currentTimeMillis()), view));
        } catch (Exception e) {
            Log.w(TAG, "Could not draw the Glyph Toy", e);
        }
    }

    /** A new forecast in the background when the snapshot is stale, then a redraw. */
    private void refreshIfStale() {
        Context app = getApplicationContext();
        new Thread(() -> {
            WeatherWidgetProvider.refreshNow(app);
            handler.post(this::draw);
        }, "glyph-toy-refresh").start();
    }

    /** What to draw, from the widget snapshot (null fields when there's no place or forecast yet). */
    static GlyphArt.Info info(Context context, JSONObject snapshot, long nowMs) {
        GlyphArt.Info info = new GlyphArt.Info();
        if (snapshot == null || snapshot.optJSONObject("place") == null) return info;
        boolean f = WeatherWidgetData.fahrenheit(snapshot);
        JSONObject now = snapshot.optJSONObject("now");
        int code = now == null || now.isNull("code") ? -1 : now.optInt("code", -1);
        boolean isDay = now == null || now.optBoolean("isDay", true);
        info.icon = code >= 0 ? GlyphArt.iconName(code, isDay) : "cloudy";
        info.temp = degrees(WeatherWidgetData.number(now, "tempC"), f);
        info.high = degrees(WeatherWidgetData.number(now, "hiC"), f);
        info.low = degrees(WeatherWidgetData.number(now, "loC"), f);
        info.warning = WeatherWidgetProvider.alertLine(context, snapshot.optJSONObject("alert"), nowMs) != null;
        return info;
    }

    private static Integer degrees(double celsius, boolean fahrenheit) {
        return Double.isNaN(celsius) ? null : WeatherWidgetData.displayTemp(celsius, fahrenheit);
    }
}
