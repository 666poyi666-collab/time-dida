/// <reference types="vite/client" />
import type { FocusLinkAPI } from '../electron/preload';

declare global {
  interface Window {
    focuslink: FocusLinkAPI;
  }
}

export {};
