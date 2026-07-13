'use client';

import { Upload } from 'tus-js-client';
import { createClient } from '@/lib/supabase/client';

export interface SignedTusUploadInput {
    file: File;
    endpoint: string;
    bucket: string;
    objectPath: string;
    uploadToken: string;
    onProgress?: (percentage: number) => void;
}

function uploadWithTus(input: SignedTusUploadInput, accessToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const upload = new Upload(input.file, {
            endpoint: input.endpoint,
            retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
            headers: {
                authorization: `Bearer ${accessToken}`,
                'x-upsert': 'false',
            },
            chunkSize: 6 * 1024 * 1024,
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            fingerprint: async (file) => [
                'nextum-assignment-pdf-v2',
                input.bucket,
                input.objectPath,
                file.name,
                file.size,
                file.lastModified,
            ].join(':'),
            metadata: {
                bucketName: input.bucket,
                objectName: input.objectPath,
                contentType: 'application/pdf',
                cacheControl: '3600',
            },
            onError: (error) => reject(error),
            onProgress: (uploaded, total) => {
                input.onProgress?.(total > 0 ? Math.round((uploaded / total) * 100) : 0);
            },
            onSuccess: () => resolve(),
        });

        void upload.findPreviousUploads().then((previous) => {
            if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
            upload.start();
        }).catch(reject);
    });
}

function isTusAuthorizationFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Invalid Compact JWS|AccessDenied|Unauthorized|response code: (401|403)|row-level security/i.test(message);
}

async function uploadWithSignedUrlFallback(input: SignedTusUploadInput): Promise<void> {
    const client = createClient();
    const { error } = await client.storage
        .from(input.bucket)
        .uploadToSignedUrl(input.objectPath, input.uploadToken, input.file, {
            cacheControl: '3600',
            contentType: 'application/pdf',
        });
    if (error) throw new Error(`Signed PDF upload failed: ${error.message}`);
    input.onProgress?.(100);
}

export async function uploadToSignedSupabasePath(input: SignedTusUploadInput): Promise<void> {
    const client = createClient();
    const { data, error } = await client.auth.getSession();
    const accessToken = data.session?.access_token;

    if (accessToken && !error) {
        try {
            await uploadWithTus(input, accessToken);
            return;
        } catch (uploadError) {
            if (!isTusAuthorizationFailure(uploadError)) throw uploadError;
        }
    }

    await uploadWithSignedUrlFallback(input);
}
