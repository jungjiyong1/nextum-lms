'use client';

import { Upload } from 'tus-js-client';

export interface SignedTusUploadInput {
    file: File;
    endpoint: string;
    bucket: string;
    objectPath: string;
    uploadToken: string;
    onProgress?: (percentage: number) => void;
}

export function uploadToSignedSupabasePath(input: SignedTusUploadInput): Promise<void> {
    return new Promise((resolve, reject) => {
        const upload = new Upload(input.file, {
            endpoint: input.endpoint,
            retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
            headers: {
                'x-signature': input.uploadToken,
                'x-upsert': 'false',
            },
            chunkSize: 6 * 1024 * 1024,
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            fingerprint: async (file) => [
                'nextum-assignment-pdf-v1',
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
