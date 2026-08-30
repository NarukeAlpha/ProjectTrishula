/// <reference types="vite/client" />

import type { RuntimeConfigSource } from "./config/runtime";

declare global {
  interface Window {
    __SIGNAL_CONFIG__?: RuntimeConfigSource;
  }
}

export {};
