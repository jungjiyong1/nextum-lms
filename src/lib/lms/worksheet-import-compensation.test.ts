import { describe, expect, it, vi } from 'vitest';
import {
    runWorksheetImportCompensation,
    type WorksheetImportCompensationOperations,
    type WorksheetImportCompensationState,
} from './worksheet-import-compensation';

function createOperations(overrides: Partial<WorksheetImportCompensationOperations> = {}) {
    const operations: WorksheetImportCompensationOperations = {
        deleteAssignment: vi.fn(async () => true),
        deleteBook: vi.fn(async () => true),
        removeStorageObjects: vi.fn(async () => true),
        ...overrides,
    };
    return operations;
}

const completeState: WorksheetImportCompensationState = {
    assignmentId: 'assignment-1',
    bookId: 'book-1',
    uploadedObjects: [
        { bucket: 'problem-images', path: 'a.png' },
        { bucket: 'problem-images', path: 'b.png' },
        { bucket: 'assignment-files', path: 'source.zip' },
    ],
};

describe('runWorksheetImportCompensation', () => {
    it('deletes database owners before grouped storage objects', async () => {
        const order: string[] = [];
        const operations = createOperations({
            deleteAssignment: vi.fn(async () => {
                order.push('assignment');
                return true;
            }),
            deleteBook: vi.fn(async () => {
                order.push('book');
                return true;
            }),
            removeStorageObjects: vi.fn(async (bucket) => {
                order.push(`storage:${bucket}`);
                return true;
            }),
        });

        await expect(runWorksheetImportCompensation(completeState, operations)).resolves.toBe(true);
        expect(order).toEqual([
            'assignment',
            'book',
            'storage:problem-images',
            'storage:assignment-files',
        ]);
        expect(operations.removeStorageObjects).toHaveBeenNthCalledWith(
            1,
            'problem-images',
            ['a.png', 'b.png'],
        );
    });

    it('preserves the book and storage when assignment deletion fails', async () => {
        const operations = createOperations({
            deleteAssignment: vi.fn(async () => false),
        });

        await expect(runWorksheetImportCompensation(completeState, operations)).resolves.toBe(false);
        expect(operations.deleteBook).not.toHaveBeenCalled();
        expect(operations.removeStorageObjects).not.toHaveBeenCalled();
    });

    it('preserves storage when book deletion throws', async () => {
        const operations = createOperations({
            deleteBook: vi.fn(async () => {
                throw new Error('network failure');
            }),
        });

        await expect(runWorksheetImportCompensation(completeState, operations)).resolves.toBe(false);
        expect(operations.removeStorageObjects).not.toHaveBeenCalled();
    });

    it('continues independent storage cleanup and reports a partial failure', async () => {
        const state: WorksheetImportCompensationState = {
            assignmentId: null,
            bookId: null,
            uploadedObjects: [
                { bucket: 'problem-images', path: 'a.png' },
                { bucket: 'assignment-files', path: 'source.zip' },
            ],
        };
        const operations = createOperations({
            removeStorageObjects: vi.fn(async (bucket) => bucket !== 'problem-images'),
        });

        await expect(runWorksheetImportCompensation(state, operations)).resolves.toBe(false);
        expect(operations.removeStorageObjects).toHaveBeenCalledTimes(2);
    });
});
