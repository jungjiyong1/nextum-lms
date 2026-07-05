// API Layer - Re-exports from modular structure
// This file maintains backward compatibility with existing imports
// The actual implementations are now in the ./api/ directory

export * from './api/index';

// For backward compatibility, also export from types
export type { Classroom, Lesson, ScheduleLesson, LessonRow, ScheduleRow, Student, Instructor } from './types';
