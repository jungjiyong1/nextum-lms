const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-sans-kr', 'files');
const destDir = path.join(__dirname, '..', 'renderer', 'styles', 'files');

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

if (fs.existsSync(sourceDir)) {
    const files = fs.readdirSync(sourceDir);
    let count = 0;
    files.forEach(file => {
        const srcFile = path.join(sourceDir, file);
        const destFile = path.join(destDir, file);
        if (fs.lstatSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, destFile);
            count++;
        }
    });
    console.log(`Copied ${count} font files to ${destDir}`);
} else {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
}
