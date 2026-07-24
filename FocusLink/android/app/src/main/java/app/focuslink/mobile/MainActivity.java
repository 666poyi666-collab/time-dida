package app.focuslink.mobile;

import android.app.PictureInPictureParams;
import android.annotation.TargetApi;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean immersiveSystemBars;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FocusRuntimePlugin.class);
        super.onCreate(savedInstanceState);
        handleFocusRuntimeIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleFocusRuntimeIntent(intent);
    }

    private void handleFocusRuntimeIntent(Intent intent) {
        FocusRuntimeCommand command = enqueueNotificationCommand(this, intent);
        clearHandledCommand(intent);
        if (command != null) {
            FocusRuntimePlugin.publishNativeCommand(command);
        }
        FocusRuntimeTileService.requestRefresh(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        // HyperOS rejects a foreground-service launch issued while the Activity is still
        // being created. Queue synchronization after resume so the system sees the same
        // foreground launch path used when a user returns to an active focus.
        getWindow().getDecorView().post(() -> FocusNotificationService.synchronize(this));
        if (immersiveSystemBars && !isFocusPictureInPictureActive()) {
            applyImmersiveSystemBars();
        }
    }

    @Override
    @TargetApi(Build.VERSION_CODES.O)
    public void onPictureInPictureModeChanged(
        boolean isInPictureInPictureMode,
        Configuration newConfig
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (!isInPictureInPictureMode && immersiveSystemBars) {
            applyImmersiveSystemBars();
        }
    }

    void setFocusImmersiveSystemBars(boolean enabled) {
        immersiveSystemBars = enabled;
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, !enabled);
        if (isFocusPictureInPictureActive()) return;

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            window,
            window.getDecorView()
        );
        if (enabled) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
        }
    }

    boolean isFocusImmersiveSystemBarsEnabled() {
        return immersiveSystemBars;
    }

    boolean supportsFocusPictureInPicture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    boolean isFocusPictureInPictureActive() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode();
    }

    @TargetApi(Build.VERSION_CODES.O)
    boolean enterFocusPictureInPicture(Integer aspectRatioWidth, Integer aspectRatioHeight) {
        if (!supportsFocusPictureInPicture()) return false;
        if (isFocusPictureInPictureActive()) return true;
        if (
            (aspectRatioWidth == null) != (aspectRatioHeight == null) ||
            (aspectRatioWidth != null &&
                (aspectRatioWidth <= 0 || aspectRatioHeight <= 0))
        ) {
            return false;
        }

        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
        if (aspectRatioWidth != null) {
            builder.setAspectRatio(new Rational(aspectRatioWidth, aspectRatioHeight));
        }
        try {
            return enterPictureInPictureMode(builder.build());
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private void applyImmersiveSystemBars() {
        setFocusImmersiveSystemBars(true);
    }

    static FocusRuntimeCommand enqueueNotificationCommand(Context context, Intent intent) {
        if (
            intent == null ||
            !FocusRuntimeContract.ACTION_NOTIFICATION_COMMAND.equals(intent.getAction())
        ) {
            return null;
        }

        String commandType = intent.getStringExtra(
            FocusRuntimeContract.EXTRA_COMMAND_TYPE
        );
        if (
            !FocusRuntimeContract.COMMAND_PAUSE.equals(commandType) &&
            !FocusRuntimeContract.COMMAND_RESUME.equals(commandType) &&
            !FocusRuntimeContract.COMMAND_FINISH.equals(commandType)
        ) {
            return null;
        }

        String sessionId = intent.getStringExtra(FocusRuntimeContract.EXTRA_SESSION_ID);
        long revision = intent.getLongExtra(
            FocusRuntimeContract.EXTRA_STATE_REVISION,
            -1L
        );
        if (sessionId == null || revision < 0L) {
            return null;
        }

        return FocusRuntimeStore.enqueueCommand(
            context,
            commandType,
            FocusRuntimeContract.SOURCE_NOTIFICATION,
            sessionId,
            revision
        );
    }

    private static void clearHandledCommand(Intent intent) {
        if (
            intent == null ||
            !FocusRuntimeContract.ACTION_NOTIFICATION_COMMAND.equals(intent.getAction())
        ) {
            return;
        }
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(FocusRuntimeContract.EXTRA_COMMAND_TYPE);
        intent.removeExtra(FocusRuntimeContract.EXTRA_SESSION_ID);
        intent.removeExtra(FocusRuntimeContract.EXTRA_STATE_REVISION);
    }
}
