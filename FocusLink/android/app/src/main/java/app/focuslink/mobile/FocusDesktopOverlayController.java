package app.focuslink.mobile;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowMetrics;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.util.Locale;

final class FocusDesktopOverlayController {
    private static final String TAG = "FocusRuntime";
    private static final long TICK_INTERVAL_MS = 1_000L;
    private static final long CLOSE_CONTROL_TIMEOUT_MS = 3_000L;

    private final Context context;
    private final Handler handler;
    private final WindowManager windowManager;
    private final Runnable tickRunnable = this::tick;
    private FrameLayout overlayView;
    private TextView timerView;
    private TextView closeView;
    private FocusRuntimeSnapshot snapshot;
    private WindowManager.LayoutParams layoutParams;
    private float downRawX;
    private float downRawY;
    private int downWindowX;
    private int downWindowY;
    private long downAtMs;
    private boolean dragging;
    private boolean frameUpdateScheduled;
    private int pendingWindowX;
    private int pendingWindowY;
    private Rect dragFrame;
    private int dragViewWidth;
    private int dragViewHeight;
    private String renderedState;
    private GradientDrawable runningBackground;
    private GradientDrawable pausedBackground;
    private final Runnable collapseControlsRunnable = this::collapseCloseControl;
    private final Runnable applyPendingPositionRunnable = this::applyPendingPosition;

    FocusDesktopOverlayController(Context context, Handler handler) {
        this.context = context.getApplicationContext();
        this.handler = handler;
        this.windowManager = context.getSystemService(WindowManager.class);
    }

    static boolean canDraw(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context);
    }

    void update(FocusRuntimeSnapshot next) {
        if (
            !next.isActive() ||
            !FocusRuntimeSystemSettings.isOverlayEnabled(context) ||
            !canDraw(context) ||
            windowManager == null
        ) {
            hide();
            return;
        }
        snapshot = next;
        if (overlayView == null) show();
        render();
        handler.removeCallbacks(tickRunnable);
        handler.postDelayed(tickRunnable, delayUntilNextSecond());
    }

    void hide() {
        handler.removeCallbacks(tickRunnable);
        handler.removeCallbacks(collapseControlsRunnable);
        snapshot = null;
        if (overlayView == null || windowManager == null) return;
        try {
            windowManager.removeView(overlayView);
        } catch (IllegalArgumentException ignored) {
            // The system already removed the overlay with the process window token.
        }
        overlayView = null;
        timerView = null;
        closeView = null;
        layoutParams = null;
        dragFrame = null;
        frameUpdateScheduled = false;
        renderedState = null;
    }

    private void show() {
        FrameLayout root = new FrameLayout(context);
        TextView timer = new TextView(context);
        timer.setTextColor(Color.WHITE);
        timer.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        timer.setGravity(Gravity.CENTER);
        int horizontal = dp(12);
        int vertical = dp(7);
        timer.setPadding(horizontal, vertical, horizontal, vertical);
        timer.setContentDescription("FocusLink 桌面专注计时；点按显示关闭按钮");
        timer.setOnClickListener(ignored -> revealCloseControl());
        timer.setOnTouchListener(this::handleTouch);
        root.addView(timer, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.START | Gravity.CENTER_VERTICAL
        ));

        TextView close = new TextView(context);
        close.setText("×");
        close.setTextColor(Color.WHITE);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("关闭悬浮计时");
        close.setBackground(roundedBackground("#9F2F2A", 8));
        close.setVisibility(View.GONE);
        close.setOnClickListener(ignored -> closeOverlayFromSurface());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(34), dp(34));
        closeParams.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
        root.addView(close, closeParams);
        root.setElevation(dp(6));

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        Rect frame = availableFrame();
        params.x = frame.left;
        params.y = frame.top;
        try {
            windowManager.addView(root, params);
            overlayView = root;
            timerView = timer;
            closeView = close;
            layoutParams = params;
            root.post(this::restorePosition);
        } catch (RuntimeException exception) {
            Log.w(TAG, "Unable to show desktop focus timer", exception);
            overlayView = null;
            timerView = null;
            closeView = null;
        }
    }

    private void tick() {
        if (snapshot == null || overlayView == null) return;
        render();
        handler.postDelayed(tickRunnable, delayUntilNextSecond());
    }

    private void render() {
        if (snapshot == null || timerView == null) return;
        long elapsedMs = snapshot.primaryElapsedMs;
        if (snapshot.primaryAdvances && snapshot.receivedAtElapsedMs >= 0L) {
            elapsedMs += Math.max(0L, SystemClock.elapsedRealtime() - snapshot.receivedAtElapsedMs);
        }
        boolean paused = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state);
        timerView.setText((paused ? "暂停 " : "专注 ") + formatDuration(elapsedMs));
        String nextState = paused ? FocusRuntimeContract.STATE_PAUSED : FocusRuntimeContract.STATE_RUNNING;
        if (!nextState.equals(renderedState)) {
            if (runningBackground == null) runningBackground = roundedBackground("#087F63", 8);
            if (pausedBackground == null) pausedBackground = roundedBackground("#C63F38", 8);
            timerView.setBackground(paused ? pausedBackground : runningBackground);
            renderedState = nextState;
        }
    }

    private void revealCloseControl() {
        if (closeView == null || timerView == null || overlayView == null) return;
        closeView.setVisibility(View.VISIBLE);
        FrameLayout.LayoutParams timerParams = (FrameLayout.LayoutParams) timerView.getLayoutParams();
        timerParams.rightMargin = dp(38);
        timerView.setLayoutParams(timerParams);
        handler.removeCallbacks(collapseControlsRunnable);
        handler.postDelayed(collapseControlsRunnable, CLOSE_CONTROL_TIMEOUT_MS);
        overlayView.post(() -> clampPosition(true));
    }

    private void collapseCloseControl() {
        if (closeView == null || timerView == null || overlayView == null) return;
        closeView.setVisibility(View.GONE);
        FrameLayout.LayoutParams timerParams = (FrameLayout.LayoutParams) timerView.getLayoutParams();
        timerParams.rightMargin = 0;
        timerView.setLayoutParams(timerParams);
        overlayView.post(() -> clampPosition(true));
    }

    private void closeOverlayFromSurface() {
        handler.removeCallbacks(collapseControlsRunnable);
        try {
            FocusRuntimeSystemSettings.setOverlayEnabled(context, false);
        } catch (IllegalStateException exception) {
            Log.w(TAG, "Unable to persist overlay close action", exception);
            return;
        }
        hide();
    }

    private boolean handleTouch(View view, MotionEvent event) {
        if (layoutParams == null || windowManager == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                downWindowX = layoutParams.x;
                downWindowY = layoutParams.y;
                downAtMs = SystemClock.uptimeMillis();
                dragging = false;
                dragFrame = availableFrame();
                dragViewWidth = overlayView == null ? 0 : overlayView.getWidth();
                dragViewHeight = overlayView == null ? 0 : overlayView.getHeight();
                handler.removeCallbacks(collapseControlsRunnable);
                return true;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                int slop = ViewConfiguration.get(context).getScaledTouchSlop();
                boolean longPressed = SystemClock.uptimeMillis() - downAtMs >= 220L;
                if (longPressed && (dragging || Math.hypot(dx, dy) >= slop)) {
                    dragging = true;
                    pendingWindowX = downWindowX + Math.round(dx);
                    pendingWindowY = downWindowY + Math.round(dy);
                    schedulePositionUpdate();
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (dragging) {
                    applyPendingPosition();
                    clampPosition(true);
                    persistPosition();
                } else {
                    view.performClick();
                }
                dragging = false;
                dragFrame = null;
                return true;
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                dragFrame = null;
                return true;
            default:
                return false;
        }
    }

    private void restorePosition() {
        if (overlayView == null || layoutParams == null) return;
        Rect frame = availableFrame();
        FocusRuntimeSystemSettings.OverlayPosition stored =
            FocusRuntimeSystemSettings.getOverlayPosition(context);
        int travelX = Math.max(0, frame.width() - overlayView.getWidth());
        int travelY = Math.max(0, frame.height() - overlayView.getHeight());
        layoutParams.x = frame.left + Math.round(travelX * stored.xFraction);
        layoutParams.y = frame.top + Math.round(travelY * stored.yFraction);
        clampPosition(true);
    }

    private void clampPosition(boolean updateLayout) {
        if (overlayView == null || layoutParams == null || windowManager == null) return;
        Rect frame = dragFrame == null ? availableFrame() : dragFrame;
        int width = dragFrame == null ? overlayView.getWidth() : dragViewWidth;
        int height = dragFrame == null ? overlayView.getHeight() : dragViewHeight;
        int maxX = Math.max(frame.left, frame.right - width);
        int maxY = Math.max(frame.top, frame.bottom - height);
        int nextX = Math.max(frame.left, Math.min(maxX, layoutParams.x));
        int nextY = Math.max(frame.top, Math.min(maxY, layoutParams.y));
        boolean changed = nextX != layoutParams.x || nextY != layoutParams.y;
        layoutParams.x = nextX;
        layoutParams.y = nextY;
        if (updateLayout || changed) {
            try {
                windowManager.updateViewLayout(overlayView, layoutParams);
            } catch (IllegalArgumentException ignored) {
                // The overlay was removed while a display/configuration change was settling.
            }
        }
    }

    private void persistPosition() {
        if (overlayView == null || layoutParams == null) return;
        Rect frame = availableFrame();
        int travelX = Math.max(1, frame.width() - overlayView.getWidth());
        int travelY = Math.max(1, frame.height() - overlayView.getHeight());
        float x = (layoutParams.x - frame.left) / (float) travelX;
        float y = (layoutParams.y - frame.top) / (float) travelY;
        FocusRuntimeSystemSettings.setOverlayPosition(context, x, y);
    }

    private void schedulePositionUpdate() {
        if (overlayView == null || frameUpdateScheduled) return;
        frameUpdateScheduled = true;
        overlayView.postOnAnimation(applyPendingPositionRunnable);
    }

    private void applyPendingPosition() {
        frameUpdateScheduled = false;
        if (!dragging || layoutParams == null) return;
        layoutParams.x = pendingWindowX;
        layoutParams.y = pendingWindowY;
        clampPosition(true);
    }

    private GradientDrawable roundedBackground(String color, int radiusDp) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.parseColor(color));
        background.setCornerRadius(dp(radiusDp));
        return background;
    }

    private Rect availableFrame() {
        if (windowManager == null) return new Rect();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowMetrics metrics = windowManager.getCurrentWindowMetrics();
            Rect bounds = new Rect(metrics.getBounds());
            WindowInsets insets = metrics.getWindowInsets();
            android.graphics.Insets safe = insets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
            );
            bounds.left += safe.left;
            bounds.top += safe.top;
            bounds.right -= safe.right;
            bounds.bottom -= safe.bottom;
            return bounds;
        }
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        return new Rect(0, statusBarHeight(), metrics.widthPixels, metrics.heightPixels);
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private int statusBarHeight() {
        int resourceId = context
            .getResources()
            .getIdentifier("status_bar_height", "dimen", "android");
        return resourceId > 0
            ? context.getResources().getDimensionPixelSize(resourceId)
            : 0;
    }

    private static long delayUntilNextSecond() {
        return 1_000L - (SystemClock.elapsedRealtime() % 1_000L) + 8L;
    }

    private static String formatDuration(long milliseconds) {
        long totalSeconds = Math.max(0L, milliseconds / 1_000L);
        long hours = totalSeconds / 3_600L;
        long minutes = (totalSeconds % 3_600L) / 60L;
        long seconds = totalSeconds % 60L;
        return hours > 0L
            ? String.format(Locale.ROOT, "%02d:%02d:%02d", hours, minutes, seconds)
            : String.format(Locale.ROOT, "%02d:%02d", minutes, seconds);
    }
}
