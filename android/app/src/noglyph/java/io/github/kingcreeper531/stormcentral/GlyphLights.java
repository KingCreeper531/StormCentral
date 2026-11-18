package io.github.kingcreeper531.stormcentral;

import android.content.Context;

/** Stand-in for builds without Nothing's Glyph SDK (src/glyph has the real one): no lights. */
final class GlyphLights {
    private GlyphLights() {}

    static void warningPosted(Context context, boolean urgent) {}
}
