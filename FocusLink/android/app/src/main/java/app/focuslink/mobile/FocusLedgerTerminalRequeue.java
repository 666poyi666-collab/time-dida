package app.focuslink.mobile;

import android.content.Context;
import androidx.work.Operation;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;

/** Coordinates the foreground-only recheck of records that remain terminal. */
final class FocusLedgerTerminalRequeue {
    interface Listener {
        void onRequeued(int requeued);

        void onStaleConnection();

        void onFailure();
    }

    private static final class Request {
        final FocusRuntimeConnectionStore.Connection connection;
        final int requeued;
        final ListenableFuture<Operation.State.SUCCESS> enqueueResult;

        Request(
            FocusRuntimeConnectionStore.Connection connection,
            int requeued,
            ListenableFuture<Operation.State.SUCCESS> enqueueResult
        ) {
            this.connection = connection;
            this.requeued = Math.max(0, requeued);
            this.enqueueResult = enqueueResult;
        }
    }

    private FocusLedgerTerminalRequeue() {}

    static void requeue(
        Context context,
        String deviceId,
        String connectionLease,
        Executor callbackExecutor,
        Listener listener
    ) {
        if (context == null || callbackExecutor == null || listener == null) {
            throw new IllegalArgumentException("terminal recheck arguments are required");
        }
        FocusRuntimeConnectionStore.Connection connection =
            FocusRuntimeConnectionStore.connectionForSource(context, deviceId, connectionLease);
        if (connection == null) {
            listener.onStaleConnection();
            return;
        }

        Request request;
        try {
            request = FocusRuntimeConnectionStore.runIfCurrent(
                context,
                connection,
                () -> {
                    int terminalCount = FocusLedgerNativeOutboxStore.prepareExplicitRecheck(
                        context,
                        connection.deviceId
                    );
                    if (terminalCount <= 0) return new Request(connection, 0, null);
                    return new Request(
                        connection,
                        terminalCount,
                        FocusLedgerSyncScheduler.scheduleExplicitTerminalRecheck(
                            context,
                            connection.deviceId
                        )
                    );
                }
            );
        } catch (RuntimeException ignored) {
            // Persistence and WorkManager details are deliberately not exposed to the WebView.
            listener.onFailure();
            return;
        }

        if (request == null) {
            listener.onStaleConnection();
            return;
        }
        if (request.enqueueResult == null) {
            listener.onRequeued(0);
            return;
        }
        try {
            request.enqueueResult.addListener(
                () -> finish(context, request, listener),
                callbackExecutor
            );
        } catch (RuntimeException ignored) {
            listener.onFailure();
        }
    }

    private static void finish(Context context, Request request, Listener listener) {
        try {
            // The listener is invoked only after completion, so this does not block a UI thread.
            request.enqueueResult.get();
            if (FocusRuntimeConnectionStore.isCurrent(context, request.connection)) {
                listener.onRequeued(request.requeued);
            } else {
                listener.onStaleConnection();
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            finishFailedEnqueue(context, request, listener);
        } catch (ExecutionException | RuntimeException exception) {
            finishFailedEnqueue(context, request, listener);
        }
    }

    private static void finishFailedEnqueue(
        Context context,
        Request request,
        Listener listener
    ) {
        if (FocusRuntimeConnectionStore.isCurrent(context, request.connection)) {
            listener.onFailure();
        } else {
            listener.onStaleConnection();
        }
    }
}
