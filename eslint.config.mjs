import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '.next/**',
            'coverage/**',
            'dist/**',
            'release/**',
            'node_modules/**',
            'node_modules (1)/**',
            'renderer/**',
            'public/pdfjs/**',
            'public/tesseract/**',
            'next-env.d.ts',
        ],
    },
    ...nextCoreWebVitals,
    ...nextTypeScript,
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
        },
        rules: {
            'react-hooks/error-boundaries': 'off',
            'react-hooks/set-state-in-effect': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': ['error', {
                checksVoidReturn: { attributes: false },
            }],
        },
    },
    {
        files: ['*.config.js'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
);
