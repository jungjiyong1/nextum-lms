import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock window.api for Electron IPC
vi.stubGlobal('api', {
    listStudents: vi.fn().mockResolvedValue([]),
    listInstructors: vi.fn().mockResolvedValue([]),
    listClassrooms: vi.fn().mockResolvedValue([]),
    listScheduleLessons: vi.fn().mockResolvedValue([]),
    // Add more mocks as needed
});
