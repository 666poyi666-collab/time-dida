package app.focuslink.mobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/** Small, injectable HTTP boundary used by the foreground runtime service. */
final class FocusCloudClient {
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    interface Transport {
        Response execute(
            String method,
            String url,
            String accessToken,
            byte[] body
        ) throws IOException;
    }

    static final class Response {
        final int status;
        final byte[] body;

        Response(int status, byte[] body) {
            this.status = status;
            this.body = body;
        }
    }

    static final class CloudException extends Exception {
        CloudException(String message) {
            super(message);
        }

        CloudException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private final Transport transport;

    FocusCloudClient(Transport transport) {
        if (transport == null) throw new IllegalArgumentException("transport is required");
        this.transport = transport;
    }

    static FocusCloudClient createDefault() {
        return new FocusCloudClient(new HttpTransport());
    }

    JSONObject fetchLive(FocusRuntimeConnectionStore.Connection connection)
        throws CloudException {
        return executeJson(
            "GET",
            connection.endpoint + "/v1/live",
            connection.accessToken,
            null,
            "cloud focus refresh"
        );
    }

    JSONObject sendCommand(
        FocusRuntimeConnectionStore.Connection connection,
        FocusRuntimeCommand command
    ) throws CloudException {
        JSONObject response = executeJson(
            "POST",
            connection.endpoint + "/v1/live/command",
            connection.accessToken,
            command.toCloudRequest(connection.deviceId).toString().getBytes(StandardCharsets.UTF_8),
            "cloud focus command"
        );
        validateTerminalAcknowledgement(command.id, response);
        return response;
    }

    static void validateTerminalAcknowledgement(String commandId, JSONObject response)
        throws CloudException {
        JSONObject acknowledgement = response.optJSONObject("ack");
        String acknowledgedId = acknowledgement == null
            ? ""
            : acknowledgement.optString("commandId", "");
        String status = acknowledgement == null
            ? ""
            : acknowledgement.optString("status", "");
        if (!commandId.equals(acknowledgedId) || !isTerminalAck(status)) {
            throw new CloudException("cloud command acknowledgement is invalid");
        }
    }

    static boolean isTerminalAck(String status) {
        return "applied".equals(status) ||
        "duplicate".equals(status) ||
        "conflict".equals(status) ||
        "rejected".equals(status);
    }

    private JSONObject executeJson(
        String method,
        String url,
        String accessToken,
        byte[] body,
        String operation
    ) throws CloudException {
        try {
            Response response = transport.execute(method, url, accessToken, body);
            if (response.status != HttpURLConnection.HTTP_OK) {
                throw new CloudException(operation + " returned HTTP " + response.status);
            }
            return new JSONObject(new String(response.body, StandardCharsets.UTF_8));
        } catch (CloudException exception) {
            throw exception;
        } catch (IOException | JSONException exception) {
            throw new CloudException(operation + " failed", exception);
        }
    }

    private static final class HttpTransport implements Transport {
        @Override
        public Response execute(
            String method,
            String url,
            String accessToken,
            byte[] body
        ) throws IOException {
            HttpURLConnection request = null;
            try {
                request = (HttpURLConnection) new URL(url).openConnection();
                request.setRequestMethod(method);
                request.setConnectTimeout(8_000);
                request.setReadTimeout(10_000);
                request.setInstanceFollowRedirects(false);
                request.setRequestProperty("Accept", "application/json");
                request.setRequestProperty("Authorization", "Bearer " + accessToken);
                if (body != null) {
                    request.setDoOutput(true);
                    request.setFixedLengthStreamingMode(body.length);
                    request.setRequestProperty("Content-Type", "application/json");
                    try (OutputStream output = request.getOutputStream()) {
                        output.write(body);
                    }
                }
                int status = request.getResponseCode();
                InputStream stream = status >= 200 && status < 300
                    ? request.getInputStream()
                    : request.getErrorStream();
                return new Response(status, stream == null ? new byte[0] : readBounded(stream));
            } finally {
                if (request != null) request.disconnect();
            }
        }
    }

    private static byte[] readBounded(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("cloud response is too large");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }
}
