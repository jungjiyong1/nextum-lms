import 'server-only';

export const ASSIGNMENT_FILES_BUCKET = process.env.NEXTUM_ASSIGNMENT_FILES_BUCKET
    || process.env.ASSIGNMENT_FILES_BUCKET
    || 'assignment-files';
