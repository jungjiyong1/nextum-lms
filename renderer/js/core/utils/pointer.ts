/**
 * Release all active pointer captures to prevent input blocking bugs
 * Call this when pointer interactions might have been interrupted
 */
const activePointerCaptures = new Map<number, HTMLElement | SVGElement>();

export function releaseAllPointerCaptures() {
    try {
        if (activePointerCaptures.size > 0) {
            activePointerCaptures.forEach((element, pointerId) => {
                try {
                    element.releasePointerCapture(pointerId);
                } catch (e) {
                    // Silently ignore - element might not have capture
                }
            });
            activePointerCaptures.clear();
            return;
        }

        // Get all elements that might have pointer capture
        const allElements = document.querySelectorAll('*');

        // Try to release pointer capture on all elements
        // This is safe - releasePointerCapture() does nothing if element doesn't have capture
        allElements.forEach((element) => {
            try {
                if (element instanceof HTMLElement || element instanceof SVGElement) {
                    // Release a wider range of possible pointer IDs as a fallback
                    for (let i = 0; i < 32; i++) {
                        (element as any).releasePointerCapture(i);
                    }
                }
            } catch (e) {
                // Silently ignore - element might not have capture
            }
        });
    } catch (error) {
        console.warn('Failed to release pointer captures:', error);
    }
}

/**
 * Safe wrapper for setPointerCapture that ensures cleanup
 */
export function safeSetPointerCapture(
    element: HTMLElement | SVGElement,
    pointerId: number,
    cleanup?: () => void
) {
    try {
        element.setPointerCapture(pointerId);
        activePointerCaptures.set(pointerId, element);

        // Ensure capture is released even if something goes wrong
        const releaseCapture = () => {
            try {
                element.releasePointerCapture(pointerId);
                cleanup?.();
            } catch (e) {
                // Already released or element removed
            }
            activePointerCaptures.delete(pointerId);

            // Remove listeners
            element.removeEventListener('pointerup', releaseCapture);
            element.removeEventListener('pointercancel', releaseCapture);
            window.removeEventListener('blur', releaseCapture);
        };

        // Auto-release on these events
        element.addEventListener('pointerup', releaseCapture, { once: true });
        element.addEventListener('pointercancel', releaseCapture, { once: true });
        window.addEventListener('blur', releaseCapture, { once: true });

        return releaseCapture;
    } catch (error) {
        console.warn('Failed to set pointer capture:', error);
        return () => { };
    }
}
