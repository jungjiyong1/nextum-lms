import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync('src/lib/lms/assignment-match.ts', 'utf8');
const uploader = readFileSync('src/lib/lms/signed-tus-upload.ts', 'utf8');

describe('immutable assignment PDF upload contract', () => {
    it('never issues overwrite-capable signed upload grants', () => {
        expect(service).toContain('.createSignedUploadUrl(job.filePath, { upsert: false })');
        expect(service).not.toContain('.createSignedUploadUrl(job.filePath, { upsert: true })');
        expect(uploader).toContain("'x-upsert': 'false'");
    });

    it('authenticates resumable uploads with the signed-in user JWT', () => {
        expect(uploader).toContain('client.auth.getSession()');
        expect(uploader).toContain('authorization: `Bearer ${accessToken}`');
        expect(uploader).not.toContain("'x-signature': input.uploadToken");
    });

    it('falls back to the server-issued signed upload URL on Storage auth incompatibility', () => {
        expect(uploader).toContain('.uploadToSignedUrl(input.objectPath, input.uploadToken, input.file');
        expect(uploader).toContain('isTusAuthorizationFailure');
    });

    it('resumes an uploaded-but-unresolved job without replacing its object', () => {
        expect(service).toContain('async function uploadedObjectExists');
        expect(service).toContain('await uploadedObjectExists(client, job.filePath)');
        expect(uploader).toContain('input.objectPath');
        expect(uploader).toContain('fingerprint: async (file)');
    });
});
