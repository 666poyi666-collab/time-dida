package app.focuslink.mobile;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@SuppressLint("ApplySharedPref") // Commands must be durable before a notification action returns.
final class FocusRuntimeStore {
    private static final Object LOCK = new Object();
    private static final String PREFERENCES_NAME = "focus_runtime_native_v1";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_COMMANDS = "commands";

    private FocusRuntimeStore() {}

    static FocusRuntimeSnapshot getSnapshot(Context context) {
        synchronized (LOCK) {
            return FocusRuntimeSnapshot.fromStored(
                context,
                preferences(context).getString(KEY_SNAPSHOT, null)
            );
        }
    }

    static void putSnapshot(Context context, FocusRuntimeSnapshot snapshot) {
        synchronized (LOCK) {
            preferences(context)
                .edit()
                .putString(KEY_SNAPSHOT, snapshot.toStoredJson().toString())
                .commit();
        }
    }

    static FocusRuntimeCommand enqueueCommand(
        Context context,
        String commandType,
        String source,
        String expectedSessionId,
        long expectedRevision
    ) {
        synchronized (LOCK) {
            FocusRuntimeSnapshot snapshot = getSnapshot(context);
            if (
                !snapshot.matches(expectedSessionId, expectedRevision) ||
                !snapshot.allowsCommands(context) ||
                !FocusRuntimeContract.isCommandAllowedForState(snapshot.state, commandType)
            ) {
                return null;
            }

            List<FocusRuntimeCommand> commands = readCommandsLocked(context);
            for (FocusRuntimeCommand existing : commands) {
                if (
                    existing.sessionId.equals(snapshot.sessionId) &&
                    existing.stateRevision == snapshot.stateRevision
                ) {
                    return null;
                }
            }

            FocusRuntimeCommand command = FocusRuntimeCommand.create(
                commandType,
                source,
                snapshot
            );
            commands.add(command);
            if (commands.size() > FocusRuntimeContract.MAX_QUEUED_COMMANDS) {
                commands = new ArrayList<>(
                    commands.subList(
                        commands.size() - FocusRuntimeContract.MAX_QUEUED_COMMANDS,
                        commands.size()
                    )
                );
            }
            writeCommandsLocked(context, commands);
            return command;
        }
    }

    static List<FocusRuntimeCommand> drainPendingCommands(Context context) {
        synchronized (LOCK) {
            // At-least-once delivery: callers must complete IDs after the cloud accepts or
            // rejects them. A process death between delivery and completion therefore retries.
            return new ArrayList<>(readCommandsLocked(context));
        }
    }

    static int completeCommands(Context context, JSArray ids) {
        if (ids == null) {
            throw new IllegalArgumentException("ids is required");
        }
        Set<String> completed = new HashSet<>();
        for (int index = 0; index < ids.length(); index++) {
            Object raw = ids.opt(index);
            if (!(raw instanceof String) || ((String) raw).isEmpty()) {
                throw new IllegalArgumentException("ids must contain non-empty strings");
            }
            completed.add((String) raw);
        }

        synchronized (LOCK) {
            List<FocusRuntimeCommand> commands = readCommandsLocked(context);
            int before = commands.size();
            commands.removeIf(command -> completed.contains(command.id));
            writeCommandsLocked(context, commands);
            return before - commands.size();
        }
    }

    static boolean hasPendingFor(Context context, FocusRuntimeSnapshot snapshot) {
        synchronized (LOCK) {
            for (FocusRuntimeCommand command : readCommandsLocked(context)) {
                if (
                    command.sessionId.equals(snapshot.sessionId) &&
                    command.stateRevision == snapshot.stateRevision
                ) {
                    return true;
                }
            }
            return false;
        }
    }

    static int pendingCount(Context context) {
        synchronized (LOCK) {
            return readCommandsLocked(context).size();
        }
    }

    static void clearForTests(Context context) {
        synchronized (LOCK) {
            preferences(context).edit().clear().commit();
        }
    }

    private static List<FocusRuntimeCommand> readCommandsLocked(Context context) {
        List<FocusRuntimeCommand> result = new ArrayList<>();
        String raw = preferences(context).getString(KEY_COMMANDS, "[]");
        long oldestAllowed = System.currentTimeMillis() - FocusRuntimeContract.MAX_COMMAND_AGE_MS;
        try {
            JSONArray array = new JSONArray(raw);
            for (int index = 0; index < array.length(); index++) {
                try {
                    FocusRuntimeCommand command = FocusRuntimeCommand.fromJson(
                        array.getJSONObject(index)
                    );
                    if (command.issuedAtEpochMs >= oldestAllowed) {
                        result.add(command);
                    }
                } catch (JSONException | IllegalArgumentException ignored) {}
            }
        } catch (JSONException ignored) {}
        return result;
    }

    private static void writeCommandsLocked(
        Context context,
        List<FocusRuntimeCommand> commands
    ) {
        JSONArray array = new JSONArray();
        for (FocusRuntimeCommand command : commands) {
            array.put(command.toJson());
        }
        preferences(context).edit().putString(KEY_COMMANDS, array.toString()).commit();
    }

    private static SharedPreferences preferences(Context context) {
        return context
            .getApplicationContext()
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }
}
