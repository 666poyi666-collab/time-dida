package app.focuslink.mobile;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
        FocusNotificationService.synchronize(this);
        FocusRuntimeTileService.requestRefresh(this);
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
