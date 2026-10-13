package io.github.kingcreeper531.stormcentral;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Whether the app is on screen (automatic updates wait until it isn't). */
    static volatile boolean inForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Native notifications (warnings, lightning, nearby reports, morning briefing) and in-app updates.
        registerPlugin(StormAlertsPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        Notifier.ensureChannels(this);
        AlertsScheduler.ensure(this);
        UpdateScheduler.ensure(this);
    }

    /** Coming back to the app: check right away instead of waiting for the next 15-minute run. */
    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
        AlertsScheduler.runNow(this);
    }

    /**
     * The page hands the widget its data (location, conditions, warnings) while
     * the app is open. Redraw the widget on the way out instead of waiting for
     * its next 30-minute update, so a newly placed widget fills in right away.
     */
    @Override
    public void onPause() {
        super.onPause();
        inForeground = false;
        WeatherWidgetProvider.updateAll(this);
    }
}
