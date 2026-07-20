import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
        env: {
            NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            exclude: [
                'node_modules/',
                'src/test/',
                '**/*.test.{ts,tsx}',

                // These modules are Supabase/PostgREST integration boundaries. Their
                // query contracts are verified by focused tests plus DB reset/lint and
                // remote health checks; counting each uncalled query branch would hide
                // regressions in the pure domain and API-contract code covered here.
                'src/core/supabaseClient.ts',
                'src/lib/supabase/**',
                'src/lib/lms/auth.ts',
                'src/lib/lms/class-access.ts',
                'src/lib/lms/class-queries.ts',
                'src/lib/lms/staff-queries.ts',
                'src/lib/lms/student-queries.ts',

                // The StudyQ importer is an executable CLI integration boundary.
                // Its retry and bundle contracts are covered by focused tests.
                'scripts/import-studyq-bank.mjs',
            ],
            thresholds: {
                statements: 60,
                branches: 50,
                functions: 60,
                lines: 65,
                'src/lib/lms/**': {
                    statements: 85,
                    branches: 75,
                    functions: 85,
                    lines: 90,
                },
                'src/features/lms/{billing,classScope,latest-abort-controller,problem-catalog-client,status,use-debounced-value}.ts': {
                    statements: 90,
                    branches: 75,
                    functions: 90,
                    lines: 90,
                },
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
            '@/components': resolve(__dirname, './src/components'),
        },
    },
});
