import { describe, expect, it } from 'vitest';

import {
    academySelectionRequired,
    findSelectedAcademy,
    type AccessibleAcademy,
} from './academy-selection';

const academies: AccessibleAcademy[] = [
    { id: 'academy-a', name: '플립수학 종암', role: 'admin' },
    { id: 'academy-b', name: '팩토플러스 2관학원', role: 'admin' },
];

describe('academy selection', () => {
    it('accepts only an academy in the accessible list', () => {
        expect(findSelectedAcademy(academies, 'academy-b')).toEqual(academies[1]);
        expect(findSelectedAcademy(academies, 'academy-c')).toBeNull();
        expect(findSelectedAcademy(academies, null)).toBeNull();
    });

    it('requires an explicit valid selection when more than one academy is available', () => {
        expect(academySelectionRequired(academies, null)).toBe(true);
        expect(academySelectionRequired(academies, 'academy-c')).toBe(true);
        expect(academySelectionRequired(academies, 'academy-a')).toBe(false);
    });

    it('allows a single-academy account to use its only academy without a cookie', () => {
        expect(academySelectionRequired(academies.slice(0, 1), null)).toBe(false);
    });
});
