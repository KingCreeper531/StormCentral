package io.github.kingcreeper531.stormcentral;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Stand-in for builds without Nothing's Glyph SDK (src/glyph has the real one): the toy draws nothing. */
public class WeatherGlyphToy extends Service {
    static volatile boolean active = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
