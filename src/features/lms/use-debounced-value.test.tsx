/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('useDebouncedValue', () => {
    it('publishes the latest filter state after 300ms', async () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 300),
            { initialProps: { value: 'initial' } },
        );

        rerender({ value: 'first' });
        await act(async () => { vi.advanceTimersByTime(200); });
        rerender({ value: 'latest' });
        await act(async () => { vi.advanceTimersByTime(299); });
        expect(result.current).toBe('initial');

        await act(async () => { vi.advanceTimersByTime(1); });
        expect(result.current).toBe('latest');
    });
});
