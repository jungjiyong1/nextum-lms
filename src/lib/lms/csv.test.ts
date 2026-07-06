import { describe, expect, it } from 'vitest';

import { csvEscape } from './csv';

describe('csvEscape', () => {
    it('escapes CSV delimiters and quotes', () => {
        expect(csvEscape('alpha,beta')).toBe('"alpha,beta"');
        expect(csvEscape('alpha "beta"')).toBe('"alpha ""beta"""');
        expect(csvEscape('alpha\nbeta')).toBe('"alpha\nbeta"');
    });

    it('prefixes formula-like values', () => {
        expect(csvEscape('=SUM(1,2)')).toBe(`"'=SUM(1,2)"`);
        expect(csvEscape('+cmd')).toBe("'+cmd");
        expect(csvEscape('-cmd')).toBe("'-cmd");
        expect(csvEscape('@cmd')).toBe("'@cmd");
    });

    it('prefixes formula-like values after leading whitespace', () => {
        expect(csvEscape('  =cmd')).toBe("'  =cmd");
        expect(csvEscape('\t=cmd')).toBe("'\t=cmd");
        expect(csvEscape('\r=cmd')).toBe(`"'\r=cmd"`);
        expect(csvEscape('\n=cmd')).toBe(`"'\n=cmd"`);
    });

    it('leaves ordinary scalar values unchanged', () => {
        expect(csvEscape('student name')).toBe('student name');
        expect(csvEscape(1234)).toBe('1234');
        expect(csvEscape(true)).toBe('true');
        expect(csvEscape(null)).toBe('');
        expect(csvEscape(undefined)).toBe('');
    });
});
