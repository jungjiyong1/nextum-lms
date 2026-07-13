import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const importer = readFileSync('scripts/import-studyq-bank.mjs', 'utf8');

describe('StudyQ importer content-addressed assets', () => {
    it('uploads one Storage object per image hash while keeping problem-specific asset rows', () => {
        expect(importer).toContain("/${BOOK_KEY}/by-sha256/${problem.asset.sha256}.");
        expect(importer).toContain('const problemByPath = new Map');
        expect(importer).toContain('return [...problemByPath.entries()]');
        expect(importer).not.toContain('Upload plan contains duplicate deterministic Storage paths');
        expect(importer).toContain('assetId: uuidV5(`asset:${problemId}:${asset.sha256}`)');
    });
});
