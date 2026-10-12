package io.github.kingcreeper531.stormcentral;

/** Home-screen widget style: a clock with today's weather. Drawing lives in {@link StyledWidgetProvider}. */
public class ClockWidgetProvider extends StyledWidgetProvider {
    @Override
    Style style() {
        return Style.CLOCK;
    }
}
