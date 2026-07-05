const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';
const watch = process.argv.includes('--watch');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .reduce((env, line) => {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
            if (!match) return env;
            env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
            return env;
        }, {});
}

const fileEnv = loadEnvFile(path.resolve(__dirname, '.env.local'));
const env = { ...fileEnv, ...process.env };

const buildOptions = {
    entryPoints: ['renderer/js/main.tsx'],
    bundle: true,
    outfile: 'renderer/bundle.js',
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    jsx: 'automatic',
    loader: {
        '.tsx': 'tsx',
        '.ts': 'ts',
    },
    alias: {
        '@': path.resolve(__dirname, 'renderer/js'),
    },
    define: {
        'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
        'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || ''),
        'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL || ''),
        'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''),
    },
    packages: 'bundle',
    minify: !isDev,
    treeShaking: true,
    drop: isDev ? [] : ['console', 'debugger'],
    legalComments: isDev ? 'eof' : 'none',
    sourcemap: isDev ? 'inline' : false,
    logLevel: 'info',
};

async function run() {
    if (watch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('Renderer build is watching...');
        return;
    }

    await esbuild.build(buildOptions);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
