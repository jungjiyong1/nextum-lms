import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./renderer/js/test/setup.ts'],
        include: ['renderer/js/**/*.test.{ts,tsx}'],
        coverage: {
            reporter: ['text', 'html'],
            exclude: ['node_modules/', 'renderer/js/test/']
        }
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './renderer/js'),
            '@/components': resolve(__dirname, './renderer/js/components'),
        }
    }
});
