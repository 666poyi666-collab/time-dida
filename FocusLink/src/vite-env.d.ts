/// <reference types="vite/client" />
import type { FocusLinkAPI } from '@shared/ipc/api';

declare global {
  interface Window {
    focuslink: FocusLinkAPI;
  }
}

export {};
