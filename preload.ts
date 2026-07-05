/* eslint-disable @typescript-eslint/no-var-requires */
const { contextBridge, ipcRenderer } = require('electron');

// Type definitions for the API
export interface ClassroomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LessonPayload {
  classroomId: number;
  title: string;
  instructor: string;
  instructorId?: number | null;
  courseId?: number | null;
  note?: string;
  isRegular?: boolean;
  day?: number;
  startSlot?: number;
  endSlot?: number;
  startDate?: string;
  endDate?: string | null;
  scheduleDate?: string;
}

export interface UpdateLessonPayload extends LessonPayload {
  id: number;
}

// Supabase로 마이그레이션됨 - IPC API는 더 이상 사용하지 않음
// api.ts에서 window.api를 설정하고 Supabase를 직접 사용
// 이 preload는 기본 Electron 기능만 노출

// Minimal preload - just expose electron info for debugging
contextBridge.exposeInMainWorld('electronInfo', {
  platform: process.platform,
  isElectron: true,
});


// Type declaration for window.api
declare global {
  interface Window {
    api: {
      listClassrooms: () => Promise<unknown>;
      createClassroom: (rect: ClassroomRect) => Promise<unknown>;
      updateClassroomPosition: (id: number, x: number, y: number) => Promise<unknown>;
      updateClassroomRect: (id: number, x: number, y: number, width: number, height: number) => Promise<unknown>;
      renameClassroom: (id: number, name: string) => Promise<unknown>;
      deleteClassroom: (id: number) => Promise<unknown>;
      resetClassrooms: () => Promise<unknown>;
      getTimetable: (classroomId: number) => Promise<unknown>;
      setSlot: (classroomId: number, day: number, slot: number, active: boolean) => Promise<unknown>;
      listLessons: (classroomId?: number) => Promise<unknown>;
      createLesson: (payload: LessonPayload) => Promise<unknown>;
      updateLesson: (payload: UpdateLessonPayload) => Promise<unknown>;
      updateLessonRule: (payload: { ruleId: number; day: number; startSlot: number; endSlot: number; startDate?: string | null; endDate?: string | null; effectiveFromDate?: string }) => Promise<unknown>;
      deleteLesson: (id: number) => Promise<unknown>;
      resetLessons: () => Promise<unknown>;
      instructors: {
        list: (filters?: { status?: string }) => Promise<unknown>;
        get: (id: number) => Promise<unknown>;
        search: (query: string) => Promise<unknown>;
        create: (data: unknown) => Promise<unknown>;
        update: (payload: unknown) => Promise<unknown>;
        delete: (id: number) => Promise<unknown>;
        monthlySalary: (payload: { id: number; year: number; month: number }) => Promise<unknown>;
        lessons: (id: number) => Promise<unknown>;
      };
      students: {
        list: (filters?: { status?: string }) => Promise<unknown>;
        get: (id: number) => Promise<unknown>;
        search: (query: string) => Promise<unknown>;
        overdue: () => Promise<unknown>;
        create: (data: unknown) => Promise<unknown>;
        update: (payload: unknown) => Promise<unknown>;
        delete: (id: number) => Promise<unknown>;
        enrollments: (id: number) => Promise<unknown>;
        payments: (id: number) => Promise<unknown>;
      };
      enrollments: {
        list: (filters?: { studentId?: number; lessonId?: number }) => Promise<unknown>;
        assign: (studentId: number, lessonId: number) => Promise<unknown>;
        unassign: (enrollmentId: number) => Promise<unknown>;
        byStudent: (studentId: number) => Promise<unknown>;
        byLesson: (lessonId: number) => Promise<unknown>;
        count: (lessonId: number) => Promise<unknown>;
      };
      schedules: {
        create: (data: unknown) => Promise<unknown>;
        update: (payload: unknown) => Promise<unknown>;
        delete: (id: number) => Promise<unknown>;
        updateStatus: (id: number, status: string) => Promise<unknown>;
        byLesson: (lessonId: number) => Promise<unknown>;
        byMonth: (yearMonth: string) => Promise<unknown>;
        byRange: (startDate: string, endDate: string) => Promise<unknown>;
        instructorMonth: (instructorId: number, yearMonth: string) => Promise<unknown>;
        instructorSalary: (instructorId: number, yearMonth: string) => Promise<unknown>;
        monthlyStats: (yearMonth: string) => Promise<unknown>;
        reset: () => Promise<unknown>;
      };
      settings: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: string) => Promise<unknown>;
        runMigrations: () => Promise<unknown>;
        resetClassrooms: () => Promise<unknown>;
        resetLessons: () => Promise<unknown>;
        resetSchedules: () => Promise<unknown>;
        resetInstructors: () => Promise<unknown>;
        resetStudents: () => Promise<unknown>;
        resetCourses: () => Promise<unknown>;
        resetEnrollments: () => Promise<unknown>;
        resetAccounting: () => Promise<unknown>;
        resetAll: () => Promise<unknown>;
      };
      accounting: {
        dashboard: (yearMonth?: string) => Promise<unknown>;
        overdue: () => Promise<unknown>;
        studentPayment: (data: unknown) => Promise<unknown>;
        cancelStudentPayment: (studentId: number, yearMonth: string) => Promise<unknown>;
        studentPayments: (studentId: number) => Promise<unknown>;
        recentPayments: (limit?: number) => Promise<unknown>;
        instructorPayment: (data: unknown) => Promise<unknown>;
        instructorPayments: (instructorId: number) => Promise<unknown>;
        recentInstructorPayments: (limit?: number) => Promise<unknown>;
        monthlyRevenue: (yearMonth: string) => Promise<unknown>;
        monthlyExpenses: (yearMonth: string) => Promise<unknown>;
        instructorEstimates: (yearMonth?: string) => Promise<unknown>;
        studentMonthlyStatus: (yearMonth?: string) => Promise<unknown>;
        createExpense: (data: unknown) => Promise<unknown>;
        getExpenses: (startDate: string, endDate: string) => Promise<unknown>;
        deleteExpense: (id: number) => Promise<unknown>;
        createOtherIncome: (data: unknown) => Promise<unknown>;
        getOtherIncome: (startDate: string, endDate: string) => Promise<unknown>;
        deleteOtherIncome: (id: number) => Promise<unknown>;
        incomeStatement: (startDate: string, endDate: string) => Promise<unknown>;
        monthlyDetails: (yearMonth: string) => Promise<unknown>;
        createPayroll: (data: unknown) => Promise<unknown>;
        listPayroll: (yearMonth?: string) => Promise<unknown>;
        getPayrollSummary: (year: string) => Promise<unknown>;
        estimateIncomeTax: (year: string) => Promise<unknown>;
        getWithholdingSummary: (year: string) => Promise<unknown>;
        getDeductibleExpenses: (startDate: string, endDate: string) => Promise<unknown>;
        getTaxSettings: () => Promise<unknown>;
        updateTaxSettings: (payload: Record<string, string>) => Promise<unknown>;
        getVatSummary: (year: string) => Promise<unknown>;
        exportTaxReport: (options: unknown) => Promise<unknown>;
        exportPayrollReport: (options: unknown) => Promise<unknown>;
      };
    };
  }
}
