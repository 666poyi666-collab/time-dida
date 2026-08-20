export const FOCUSLINK_SERVICE_ORIGIN = "https://focuslink-upstream.internal";

export function focuslinkUpstreamUrl(pathname: string): URL {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("invalid_focuslink_upstream_path");
  }
  return new URL(pathname, FOCUSLINK_SERVICE_ORIGIN);
}
