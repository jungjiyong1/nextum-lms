import { releaseAllPointerCaptures } from './core/utils/pointer';

// Global safety: Release all pointer captures when clicking anywhere
// This prevents the "input won't focus" bug
let lastReleaseTime = 0;

document.addEventListener('pointerdown', (e) => {
    // Debounce to avoid excessive calls
    const now = Date.now();
    if (now - lastReleaseTime > 1000) {
        // Only release if clicking on an input, textarea, select, or button
        const target = (document.elementFromPoint(e.clientX, e.clientY) || (e.target as HTMLElement | null)) as HTMLElement | null;
        if (
            target &&
            (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.tagName === 'BUTTON' ||
                target.isContentEditable ||
                target.closest('input, textarea, select, button, [contenteditable="true"]')
            )
        ) {
            releaseAllPointerCaptures();
            lastReleaseTime = now;
        }
    }
}, true); // Use capture phase

// Also release on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        releaseAllPointerCaptures();
    }
});

export { };
