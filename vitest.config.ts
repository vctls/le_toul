// vitest.config.ts
import { defineConfig } from 'vitest/config'
import vue2 from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
    plugins: [vue2()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'frontend'),
        },
    },
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['./vitest.setup.ts'],
        include: ['**/*.{test,spec}.{js,ts,jsx,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
        css: true, // Handle CSS imports
    },
})
