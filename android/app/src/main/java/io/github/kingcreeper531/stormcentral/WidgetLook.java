package io.github.kingcreeper531.stormcentral;

import android.content.Context;

/**
 * Colours and layouts for every widget style, from the app's settings: light
 * or dark (the theme), on a solid panel or transparent over the wallpaper.
 * Transparent widgets use white text with a shadow (baked into the
 * "_clear" layouts) so they read on any wallpaper.
 */
final class WidgetLook {

    final boolean light;
    final boolean clear;
    final int ink;
    final int ink2;
    final int ink3;
    final int alert;
    final int background;

    private WidgetLook(boolean light, boolean clear) {
        this.light = light;
        this.clear = clear;
        if (clear) {
            ink = 0xFFFFFFFF;
            ink2 = 0xEBFFFFFF;
            ink3 = 0xC7FFFFFF;
            alert = 0xFFFF8A80;
            background = R.drawable.widget_background_clear;
        } else {
            ink = light ? 0xFF111316 : 0xFFECECED;
            ink2 = light ? 0xFF474C54 : 0xFFA8ACB3;
            ink3 = light ? 0xFF61666E : 0xFF80858D;
            alert = light ? 0xFFC62A2F : 0xFFE5484D;
            background = light ? R.drawable.widget_background_light : R.drawable.widget_background;
        }
    }

    static WidgetLook of(Context context) {
        return new WidgetLook(WeatherWidgetProvider.isLight(context), WeatherWidgetData.transparent(context));
    }

    /** The layout to inflate: the transparent twin (text shadows) or the solid one. */
    int layout(int solid, int transparent) {
        return clear ? transparent : solid;
    }
}
