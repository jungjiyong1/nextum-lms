export interface WorksheetImportCompensationState {
    bookId: string | null;
    assignmentId: string | null;
    uploadedObjects: Array<{ bucket: string; path: string }>;
}

export interface WorksheetImportCompensationOperations {
    deleteAssignment(assignmentId: string): Promise<boolean>;
    deleteBook(bookId: string): Promise<boolean>;
    removeStorageObjects(bucket: string, paths: string[]): Promise<boolean>;
}

async function attempt(operation: () => Promise<boolean>): Promise<boolean> {
    try {
        return await operation();
    } catch {
        return false;
    }
}

/**
 * Reverses a partially completed worksheet import in dependency order.
 * Storage is removed only after every created database owner has been deleted;
 * otherwise the surviving assignment/book must retain its referenced files.
 */
export async function runWorksheetImportCompensation(
    state: WorksheetImportCompensationState,
    operations: WorksheetImportCompensationOperations,
): Promise<boolean> {
    let succeeded = true;
    let databaseCleanupSucceeded = true;

    if (state.assignmentId) {
        databaseCleanupSucceeded = await attempt(() => operations.deleteAssignment(state.assignmentId!));
        succeeded &&= databaseCleanupSucceeded;
    }

    if (databaseCleanupSucceeded && state.bookId) {
        databaseCleanupSucceeded = await attempt(() => operations.deleteBook(state.bookId!));
        succeeded &&= databaseCleanupSucceeded;
    }

    if (!databaseCleanupSucceeded) return false;

    const pathsByBucket = new Map<string, string[]>();
    for (const item of state.uploadedObjects) {
        const paths = pathsByBucket.get(item.bucket) || [];
        paths.push(item.path);
        pathsByBucket.set(item.bucket, paths);
    }

    for (const [bucket, paths] of pathsByBucket) {
        const removed = await attempt(() => operations.removeStorageObjects(bucket, paths));
        succeeded &&= removed;
    }

    return succeeded;
}
