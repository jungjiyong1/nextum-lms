import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Classroom } from '../core/types';

export interface ClassroomState {
    classrooms: Record<number, Classroom>;
    selectedId: number | null;
    editMode: boolean;
}

export interface ClassroomActions {
    setClassrooms: (list: Classroom[]) => void;
    addClassroom: (classroom: Classroom) => void;
    updateClassroom: (id: number, updates: Partial<Classroom>) => void;
    removeClassroom: (id: number) => void;
    selectClassroom: (id: number | null) => void;
    toggleEditMode: () => void;
    setEditMode: (editMode: boolean) => void;
    clear: () => void;
}

const initialState: ClassroomState = {
    classrooms: {},
    selectedId: null,
    editMode: false,
};

export const useClassroomStore = create<ClassroomState & ClassroomActions>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        setClassrooms: (list) => {
            const map: Record<number, Classroom> = {};
            list.forEach((classroom) => {
                map[classroom.id] = classroom;
            });
            set({ classrooms: map });
        },

        addClassroom: (classroom) => {
            const { classrooms } = get();
            const newClassrooms = { ...classrooms, [classroom.id]: classroom };
            set({ classrooms: newClassrooms });
        },

        updateClassroom: (id, updates) => {
            const { classrooms } = get();
            const existing = classrooms[id];
            if (existing) {
                const newClassrooms = { ...classrooms, [id]: { ...existing, ...updates } };
                set({ classrooms: newClassrooms });
            }
        },

        removeClassroom: (id) => {
            const { classrooms, selectedId } = get();
            const newClassrooms = { ...classrooms };
            delete newClassrooms[id];
            set({
                classrooms: newClassrooms,
                selectedId: selectedId === id ? null : selectedId,
            });
        },

        selectClassroom: (id) => set({ selectedId: id }),
        toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),
        setEditMode: (editMode) => set({ editMode }),

        clear: () => set(initialState),
    }))
);

// Selectors
export const selectSelectedClassroom = (state: ClassroomState) =>
    state.selectedId !== null ? state.classrooms[state.selectedId] : undefined;
