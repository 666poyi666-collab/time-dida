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
import android.widget.TextView;
import java.util.Locale;

final class FocusDesktopOverlayController {
    private static final String TAG = "FocusRuntime";
    private static final long TICK_INTERVAL_MS = 1_000L;

    private final Context context;
    private final Handler handler;
    private final WindowManager windowManager;
    private final Runnable tickRunnable = this::tick;
    private TextView textView;
    private FocusRuntimeSnapshot snapshot;
    private WindowManager.LayoutParams layoutParams;
    private float downRawX;
    private float downRawY;
    private int downWindowX;
    private int downWindowY;
    private long downAtMs;
    private boolean dragging;

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
        if (textView == null) show();
        render();
        handler.removeCallbacks(tickRunnable);
        handler.postDelayed(tickRunnable, delayUntilNextSecond());
    }

    void hide() {
        handler.removeCallbacks(tickRunnable);
        snapshot = null;
        if (textView == null || windowManager == null) return;
        try {
            windowManager.removeView(textView);
        } catch (IllegalArgumentException ignored) {
            // The system already removed the overlay with the process window token.
        }
        textView = null;
        layoutParams = null;
    }

    private void show() {
        TextView view = new TextView(context);
        view.setTextColor(Color.WHITE);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
        view.setGravity(Gravity.CENTER);
        int horizontal = dp(12);
        int vertical = dp(7);
        view.setPadding(horizontal, vertical, horizontal, vertical);
        view.setElevation(dp(6));
        view.setContentDescription("FocusLink 桌面专注计时");
        view.setOnClickListener(this::openFocusLink);
        view.setOnTouchListener(this::handleTouch);

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
            windowManager.addView(view, params);
            textView = view;
            layoutParams = params;
            view.post(this::restorePosition);
        } catch (RuntimeException exception) {
            Log.w(TAG, "Unable to show desktop focus timer", exception);
            textView = null;
        }
    }

    private void tick() {
        if (snapshot == null || textView == null) return;
        render();
        handler.postDelayed(tickRunnable, delayUntilNextSecond());
    }

    private void render() {
        if (snapshot == null || textView == null) return;
        clampPosition(false);
        long elapsedMs = snapshot.primaryElapsedMs;
        if (snapshot.primaryAdvances && snapshot.receivedAtElapsedMs >= 0L) {
            elapsedMs += Math.max(0L, SystemClock.elapsedRealtime() - snapshot.receivedAtElapsedMs);
        }
        boolean paused = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state);
        textView.setText((paused ? "暂停 " : "专注 ") + formatDuration(elapsedMs));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.parseColor(paused ? "#C63F38" : "#087F63"));
        background.setCornerRadius(dp(8));
        textView.setBackground(background);
    }

    private void openFocusLink(View ignored) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) return;
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            context.startActivity(intent);
        } catch (RuntimeException exception) {
            Log.w(TAG, "Unable to open FocusLink from desktop timer", exception);
        }
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
                return true;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                int slop = ViewConfiguration.get(context).getScaledTouchSlop();
                boolean longPressed = SystemClock.uptimeMillis() - downAtMs >= 220L;
                if (longPressed && (dragging || Math.hypot(dx, dy) >= slop)) {
                    dragging = true;
                    layoutParams.x = downWindowX + Math.round(dx);
                    layoutParams.y = downWindowY + Math.round(dy);
                    clampPosition(true);
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (dragging) {
                    clampPosition(true);
                    persistPosition();
                } else {
                    view.performClick();
                }
                dragging = false;
                return true;
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                return true;
            default:
                return false;
        }
    }

    private void restorePosition() {
        if (textView == null || layoutParams == null) return;
        Rect frame = availableFrame();
        FocusRuntimeSystemSettings.OverlayPosition stored =
            FocusRuntimeSystemSettings.getOverlayPosition(context);
        int travelX = Math.max(0, frame.width() - textView.getWidth());
        int travelY = Math.max(0, frame.height() - textView.getHeight());
        layoutParams.x = frame.left + Math.round(travelX * stored.xFraction);
        layoutParams.y = frame.top + Math.round(travelY * stored.yFraction);
        clampPosition(true);
    }

    private void clampPosition(boolean updateLayout) {
        if (textView == null || layoutParams == null || windowManager == null) return;
        Rect frame = availableFrame();
        int maxX = Math.max(frame.left, frame.right - textView.getWidth());
        int maxY = Math.max(frame.top, frame.bottom - textView.getHeight());
        int nextX = Math.max(frame.left, Math.min(maxX, layoutParams.x));
        int nextY = Math.max(frame.top, Math.min(maxY, layoutParams.y));
        boolean changed = nextX != layoutParams.x || nextY != layoutParams.y;
        layoutParams.x = nextX;
        layoutParams.y = nextY;
        if (updateLayout || changed) {
            try {
                windowManager.updateViewLayout(textView, layoutParams);
            } catch (IllegalArgumentException ignored) {
                // The overlay was removed while a display/configuration change was settling.
            }
        }
    }

    private void persistPosition() {
        if (textView == null || layoutParams == null) return;
        Rect frame = availableFrame();
        int travelX = Math.max(1, frame.width() - textView.getWidth());
        int travelY = Math.max(1, frame.height() - textView.getHeight());
        float x = (layoutParams.x - frame.left) / (float) travelX;
        float y = (layoutParams.y - frame.top) / (float) travelY;
        FocusRuntimeSystemSettings.setOverlayPosition(context, x, y);
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
