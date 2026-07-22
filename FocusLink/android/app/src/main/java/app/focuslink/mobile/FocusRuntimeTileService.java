package app.focuslink.mobile;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

public final class FocusRuntimeTileService extends TileService {
    static void requestRefresh(Context context) {
        TileService.requestListeningState(
            context.getApplicationContext(),
            new ComponentName(context, FocusRuntimeTileService.class)
        );
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        refreshTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (isLocked()) {
            unlockAndRun(this::handleUnlockedClick);
            return;
        }
        handleUnlockedClick();
    }

    private void handleUnlockedClick() {
        FocusRuntimeSnapshot snapshot = FocusRuntimeStore.getSnapshot(this);
        if (
            !snapshot.allowsCommands(this) ||
            FocusRuntimeStore.hasPendingFor(this, snapshot)
        ) {
            openApp();
            return;
        }

        String commandType = FocusRuntimeContract.STATE_RUNNING.equals(snapshot.state)
            ? FocusRuntimeContract.COMMAND_PAUSE
            : FocusRuntimeContract.COMMAND_RESUME;
        FocusRuntimeCommand command = FocusRuntimeStore.enqueueCommand(
            this,
            commandType,
            FocusRuntimeContract.SOURCE_QUICK_SETTINGS,
            snapshot.sessionId,
            snapshot.stateRevision
        );
        if (command != null) {
            FocusRuntimePlugin.publishNativeCommand(command);
        }
        FocusNotificationService.synchronize(this);
        refreshTile();
        if (
            FocusRuntimeConnectionStore.get(this) == null ||
            !FocusNotificationPermission.canPost(this)
        ) openApp();
    }

    private void refreshTile() {
        Tile tile = getQsTile();
        if (tile == null) {
            return;
        }
        FocusRuntimeSnapshot snapshot = FocusRuntimeStore.getSnapshot(this);
        boolean pending = FocusRuntimeStore.hasPendingFor(this, snapshot);
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_stat_focus));

        if (pending) {
            // Some OEM SystemUI implementations cache STATE_UNAVAILABLE and do not honor the
            // next requestListeningState call. Keep the tile inactive but clickable so a stale
            // "waiting" presentation can always reopen the app and drain/refresh the queue.
            tile.setState(Tile.STATE_INACTIVE);
            tile.setLabel(getString(R.string.focus_runtime_tile_waiting));
            setSubtitle(tile, getString(R.string.focus_runtime_waiting));
        } else if (!snapshot.allowsCommands(this)) {
            tile.setState(Tile.STATE_INACTIVE);
            tile.setLabel(getString(R.string.focus_runtime_tile_open));
            setSubtitle(tile, getString(R.string.focus_runtime_tile_label));
        } else if (FocusRuntimeContract.STATE_RUNNING.equals(snapshot.state)) {
            tile.setState(Tile.STATE_ACTIVE);
            tile.setLabel(getString(R.string.focus_runtime_tile_pause));
            setSubtitle(tile, snapshot.timeLabel);
        } else {
            tile.setState(Tile.STATE_INACTIVE);
            tile.setLabel(getString(R.string.focus_runtime_tile_resume));
            setSubtitle(tile, snapshot.timeLabel);
        }
        tile.updateTile();
    }

    private void setSubtitle(Tile tile, String subtitle) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(subtitle);
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    private void openApp() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) {
            launchIntent = new Intent(this, MainActivity.class);
        }
        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            startActivityAndCollapse(pendingIntent);
        } else {
            startActivityAndCollapse(launchIntent);
        }
    }
}
