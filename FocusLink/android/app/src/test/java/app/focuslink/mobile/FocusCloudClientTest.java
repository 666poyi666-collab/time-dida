package app.focuslink.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

public class FocusCloudClientTest {
    private static final FocusRuntimeConnectionStore.Connection CONNECTION =
        new FocusRuntimeConnectionStore.Connection(
            "https://sync.example.test",
            "test-token",
            "android-test"
        );

    @Test
    public void acceptsEveryTerminalCommandAcknowledgement() throws Exception {
        for (String status : new String[] { "applied", "duplicate", "conflict", "rejected" }) {
            RecordingTransport transport = new RecordingTransport(
                200,
                commandResponse("command-1", status)
            );
            FocusCloudClient client = new FocusCloudClient(transport);

            JSONObject response = client.sendCommand(CONNECTION, command("command-1"));

            assertEquals(status, response.getJSONObject("ack").getString("status"));
            assertEquals("POST", transport.method);
            assertEquals(
                "https://sync.example.test/v1/live/command",
                transport.url
            );
            JSONObject request = new JSONObject(
                new String(transport.body, StandardCharsets.UTF_8)
            );
            assertEquals("android-test", request.getString("deviceId"));
            assertEquals(
                "command-1",
                request.getJSONObject("command").getString("commandId")
            );
        }
    }

    @Test
    public void rejectsMismatchedOrNonTerminalAcknowledgements() throws Exception {
        assertCommandRejected(commandResponse("other-command", "applied"));
        assertCommandRejected(commandResponse("command-1", "pending"));
        assertCommandRejected("{\"snapshot\":{}}");
    }

    @Test
    public void preservesRetryabilityForNetworkHttpAndJsonFailures() throws Exception {
        FocusCloudClient networkClient = new FocusCloudClient(
            (method, url, token, body) -> {
                throw new IOException("offline");
            }
        );
        assertCloudFailure(() -> networkClient.sendCommand(CONNECTION, command("command-1")));

        FocusCloudClient httpClient = new FocusCloudClient(
            new RecordingTransport(503, "temporarily unavailable")
        );
        assertCloudFailure(() -> httpClient.sendCommand(CONNECTION, command("command-1")));

        FocusCloudClient invalidJsonClient = new FocusCloudClient(
            new RecordingTransport(200, "not-json")
        );
        assertCloudFailure(() -> invalidJsonClient.sendCommand(CONNECTION, command("command-1")));
    }

    @Test
    public void fetchesLiveSnapshotThroughTheInjectedTransport() throws Exception {
        RecordingTransport transport = new RecordingTransport(
            200,
            "{\"protocolVersion\":1,\"revision\":9,\"session\":null}"
        );
        JSONObject response = new FocusCloudClient(transport).fetchLive(CONNECTION);

        assertEquals(9, response.getInt("revision"));
        assertEquals("GET", transport.method);
        assertEquals("https://sync.example.test/v1/live", transport.url);
        assertEquals("test-token", transport.accessToken);
    }

    @Test
    public void exposesHuaweiXiaomiAndFallbackCandidatesDeterministically() {
        List<String> huawei = FocusRuntimePlugin.autoStartSettingsCandidateKeys("HUAWEI");
        assertTrue(
            huawei.contains("action:huawei.intent.action.HSM_STARTUPAPP_MANAGER")
        );
        assertTrue(
            huawei.get(0).contains("StartupNormalAppListActivity")
        );

        List<String> xiaomi = FocusRuntimePlugin.autoStartSettingsCandidateKeys("Xiaomi");
        assertEquals(1, xiaomi.size());
        assertTrue(xiaomi.get(0).contains("AutoStartManagementActivity"));

        assertTrue(
            FocusRuntimePlugin.autoStartSettingsCandidateKeys("Google").isEmpty()
        );
    }

    private static FocusRuntimeCommand command(String id) throws Exception {
        return FocusRuntimeCommand.fromJson(
            new JSONObject()
                .put("id", id)
                .put("type", FocusRuntimeContract.COMMAND_PAUSE)
                .put("source", FocusRuntimeContract.SOURCE_NOTIFICATION)
                .put("sessionId", "session-1")
                .put("stateRevision", 4)
                .put("issuedAtEpochMs", System.currentTimeMillis())
        );
    }

    private static String commandResponse(String commandId, String status) {
        return "{\"ack\":{\"commandId\":\"" + commandId +
        "\",\"status\":\"" + status + "\"}}";
    }

    private static void assertCommandRejected(String response) throws Exception {
        FocusCloudClient client = new FocusCloudClient(new RecordingTransport(200, response));
        assertCloudFailure(() -> client.sendCommand(CONNECTION, command("command-1")));
    }

    private static void assertCloudFailure(ThrowingRunnable runnable) throws Exception {
        try {
            runnable.run();
            fail("Expected cloud failure");
        } catch (FocusCloudClient.CloudException expected) {
            assertNotNull(expected.getMessage());
        }
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final class RecordingTransport implements FocusCloudClient.Transport {
        private final int responseStatus;
        private final byte[] responseBody;
        String method;
        String url;
        String accessToken;
        byte[] body;

        RecordingTransport(int responseStatus, String responseBody) {
            this.responseStatus = responseStatus;
            this.responseBody = responseBody.getBytes(StandardCharsets.UTF_8);
        }

        @Override
        public FocusCloudClient.Response execute(
            String method,
            String url,
            String accessToken,
            byte[] body
        ) {
            this.method = method;
            this.url = url;
            this.accessToken = accessToken;
            this.body = body;
            return new FocusCloudClient.Response(responseStatus, responseBody);
        }
    }
}
