package io.github.kingcreeper531.stormcentral;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/** Checks for app updates every 6 hours (GitHub allows 60 unauthenticated API calls an hour). */
final class UpdateScheduler {
    private static final String NAME = "stormcentral-app-update";

    private UpdateScheduler() {}

    static void ensure(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(UpdateWorker.class, 6, TimeUnit.HOURS).setConstraints(c).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }
}
