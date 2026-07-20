import type { NextConfig } from 'next';

const securityHeaders = [
    {
        key: 'Content-Security-Policy',
        value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    },
    {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
    },
    {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
    },
    {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
    },
    {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
    },
    {
        key: 'X-Frame-Options',
        value: 'DENY',
    },
];

const nextConfig: NextConfig = {
    poweredByHeader: false,
    reactStrictMode: true,
    serverExternalPackages: ['@napi-rs/canvas', 'tesseract.js', 'tesseract.js-core'],
    outputFileTracingIncludes: {
        '/api/lms/assignment-match-jobs/*/resolve': [
            './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
            './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
            './node_modules/pdfjs-dist/cmaps/**/*',
            './node_modules/pdfjs-dist/standard_fonts/**/*',
            './node_modules/pdfjs-dist/wasm/**/*',
            './node_modules/tesseract.js-core/package.json',
            './node_modules/tesseract.js-core/tesseract-core-lstm.js',
            './node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
            './node_modules/tesseract.js-core/tesseract-core-simd-lstm.js',
            './node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
            './node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js',
            './node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm',
            './public/tesseract/lang/**/*',
        ],
        // PDF 임베드용 한글 TTF는 fs로 읽으므로 함수 번들에 명시적으로 포함한다.
        '/api/lms/worksheets/render': [
            './src/lib/lms/render/fonts/*.ttf',
        ],
    },
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: securityHeaders,
            },
        ];
    },
};

export default nextConfig;
