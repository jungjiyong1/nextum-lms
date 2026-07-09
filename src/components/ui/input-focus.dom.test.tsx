/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Input } from './input';

afterEach(cleanup);

describe('Input focus', () => {
    it('keeps focus while the user clicks and types', () => {
        render(<Input aria-label="학생 검색" />);

        const input = screen.getByRole('textbox', { name: '학생 검색' });
        fireEvent.pointerDown(input);
        fireEvent.click(input);
        fireEvent.change(input, { target: { value: '홍길동' } });

        expect(input).toHaveFocus();
        expect(input).toHaveValue('홍길동');
    });
});
