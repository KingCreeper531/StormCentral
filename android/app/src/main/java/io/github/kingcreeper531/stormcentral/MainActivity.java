package io.github.kingcreeper531.stormcentral;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * The page hands the widget its data (location, conditions, warnings) while
     * the app is open. Redraw the widget on the way out instead of waiting for
     * its next 30-minute update, so a newly placed widget fills in right away.
     */
    @Override
    public void onPause() {
        super.onPause();
        WeatherWidgetProvider.updateAll(this);
    }
}
