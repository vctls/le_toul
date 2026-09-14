// vite.config.prod.ts
import { defineConfig, mergeConfig } from "vite";
import commonConfig from "./vite.config.common";

export default mergeConfig(
  commonConfig,
  defineConfig({
    // Production-specific settings
    build: {
      minify: true,
    },
  }),
);
