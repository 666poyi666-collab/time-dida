package app.focuslink.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class FocusLedgerSyncReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (
            !Intent.ACTION_BOOT_COMPLETED.equals(action) &&
            !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        ) {
            return;
        }
        FocusRuntimeConnectionStore.Connection connection = FocusRuntimeConnectionStore.get(context);
        if (
            connection != null &&
            FocusLedgerNativeOutboxStore.countForDevice(context, connection.deviceId) > 0
        ) {
            FocusLedgerSyncScheduler.schedule(context);
        }
    }
}
