export type MobileLiveLifecycleAction = 'suspend' | 'reconnect' | 'wait';

/**
 * Keep renderer lifecycle decisions independent from React and Capacitor event ordering.
 * Hidden/inactive always cancels the current request; only one visible, online, configured
 * transition is allowed to start a replacement loop.
 */
export function resolveMobileLiveLifecycleAction(input: {
  appActive: boolean;
  documentVisible: boolean;
  online: boolean;
  configured: boolean;
}): MobileLiveLifecycleAction {
  if (!input.appActive || !input.documentVisible) return 'suspend';
  if (!input.online || !input.configured) return 'wait';
  return 'reconnect';
}
