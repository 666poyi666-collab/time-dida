import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.focuslink.mobile',
  appName: 'FocusLink',
  webDir: 'dist-mobile',
  // Capacitor debug logging serializes complete plugin arguments. Pairing and
  // native-runtime calls contain the device bearer credential, so it remains
  // disabled for every locally built variant as well as release builds.
  loggingBehavior: 'none',
};

export default config;
