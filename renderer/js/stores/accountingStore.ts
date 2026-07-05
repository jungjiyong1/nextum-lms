import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface AccountingState {
    yearMonth: string;
    activeTab: string;
    taxView: 'monthly' | 'annual';
    taxYear: string;
    exportStart: string;
    exportEnd: string;
}

export interface AccountingActions {
    setYearMonth: (value: string) => void;
    setActiveTab: (value: string) => void;
    setTaxYear: (value: string) => void;
    setTaxView: (value: 'monthly' | 'annual') => void;
    setExportRange: (start: string, end: string) => void;
    reset: () => void;
}

const now = new Date();
const currentYear = String(now.getFullYear());
const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

const initialState: AccountingState = {
    yearMonth: `${currentYear}-${currentMonth}`,
    activeTab: 'students',
    taxView: 'monthly',
    taxYear: currentYear,
    exportStart: `${currentYear}-01-01`,
    exportEnd: `${currentYear}-12-31`,
};

export const useAccountingStore = create<AccountingState & AccountingActions>()(
    subscribeWithSelector((set) => ({
        ...initialState,

        setYearMonth: (value) => set({ yearMonth: value }),
        setActiveTab: (value) => set({ activeTab: value }),
        setTaxYear: (value) => set({ taxYear: value }),
        setTaxView: (value) => set({ taxView: value }),
        setExportRange: (start, end) => set({ exportStart: start, exportEnd: end }),

        reset: () => set(initialState),
    }))
);
