package app.focuslink.mobile;

import android.app.Notification;
import android.os.Bundle;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** HyperOS focus-notification projection, isolated from the standard foreground notification. */
final class XiaomiIslandAdapter {
    static final String EVIDENCE_UNSUPPORTED = "unsupported";
    static final String EVIDENCE_PROTOCOL_SELECTED = "protocol-selected";
    static final String EVIDENCE_SYSTEMUI_ACCEPTED = "systemui-accepted";
    static final String EVIDENCE_VISUALLY_VERIFIED = "visually-verified";

    private XiaomiIslandAdapter() {}

    static Notification apply(
        Notification notification,
        FocusRuntimeSnapshot snapshot,
        String displayTitle,
        String displayContent
    ) {
        try {
            boolean paused = FocusRuntimeContract.STATE_PAUSED.equals(snapshot.state);
            String stateLabel = paused ? "暂停" : "专注";
            String businessId = "focuslink:" + snapshot.sessionId;
            JSONObject textInfo = new JSONObject()
                .put("frontTitle", stateLabel)
                .put("title", snapshot.timeLabel)
                .put("content", displayTitle)
                .put("useHighLight", false);
            JSONObject island = new JSONObject()
                .put("islandProperty", 1)
                .put("businessId", businessId)
                .put("updatable", true)
                .put(
                    "bigIslandArea",
                    new JSONObject().put(
                        "imageTextInfoLeft",
                        new JSONObject().put("type", 1).put("textInfo", textInfo)
                    )
                )
                .put(
                    "smallIslandArea",
                    new JSONObject().put("textInfo", new JSONObject().put("title", snapshot.timeLabel))
                );
            JSONObject paramV2 = new JSONObject()
                .put("protocol", 3)
                .put("businessId", businessId)
                .put("enableFloat", true)
                .put("updatable", true)
                .put("isPaused", paused)
                .put("ticker", stateLabel + " " + snapshot.timeLabel)
                .put(
                    "baseInfo",
                    new JSONObject().put("title", displayTitle).put("content", displayContent).put("type", 2)
                )
                .put("hintInfo", new JSONObject().put("type", 1).put("title", snapshot.timeLabel))
                .put("param_island", island);

            Bundle actionBundle = new Bundle();
            JSONArray actionDescriptors = new JSONArray();
            if (notification.actions != null) {
                for (int index = 0; index < notification.actions.length; index++) {
                    String key = "focuslink_action_" + index;
                    actionBundle.putParcelable(key, notification.actions[index]);
                    actionDescriptors.put(new JSONObject().put("action", key));
                }
            }
            if (actionDescriptors.length() > 0) {
                paramV2.put("actions", actionDescriptors);
                notification.extras.putBundle("miui.focus.actions", actionBundle);
            }
            notification.extras.putString("miui.focus.param", new JSONObject().put("param_v2", paramV2).toString());
            notification.extras.putString("focuslink.xiaomi.businessId", businessId);
            notification.extras.putString("focuslink.xiaomi.projectionId", UUID.nameUUIDFromBytes(businessId.getBytes()).toString());
        } catch (JSONException ignored) {
            // The independent standard ongoing notification remains valid.
        }
        return notification;
    }
}
