/**
 * Design System - Theme Tokens & Component Styles
 * 
 * 공통 디자인 토큰과 컴포넌트 스타일 프리셋을 정의합니다.
 * 모든 컴포넌트에서 일관된 디자인을 유지하기 위해 이 파일을 참조하세요.
 */

// =============================================================================
// COLOR TOKENS
// =============================================================================

/**
 * 프로젝트 메인 컬러 팔레트 (녹색 계열)
 * CSS 변수와 동기화됨
 */
export const colors = {
    // Primary Green (메인 녹색)
    primary: {
        DEFAULT: '#1f9d57',      // --accent
        strong: '#138a48',       // --accent-strong (hover)
        soft: '#d6f1e2',         // --accent-soft (배경)
        glow: 'rgba(31, 157, 87, 0.25)', // 그림자/글로우
    },

    // Semantic Colors
    success: {
        DEFAULT: '#22c55e',
        soft: '#dcfce7',
        text: '#166534',
    },
    warning: {
        DEFAULT: '#f59e0b',
        soft: '#fef3c7',
        text: '#92400e',
    },
    danger: {
        DEFAULT: '#d95b5b',      // --danger
        soft: '#ffe3e3',         // --danger-soft
        text: '#991b1b',
    },
    info: {
        DEFAULT: '#3b82f6',
        soft: '#dbeafe',
        text: '#1e40af',
    },

    // Neutral (UI 기본)
    background: {
        DEFAULT: '#f7f8f7',      // --bg
        deep: '#ecefed',         // --bg-deep
        panel: '#ffffff',        // --panel
    },
    text: {
        DEFAULT: '#1b1f1c',      // --ink
        muted: '#5f6b66',        // --muted
    },
    border: {
        DEFAULT: '#e3e8e5',      // --panel-border
        input: '#cbd5e1',
    },
} as const;

// =============================================================================
// COMPONENT STYLE PRESETS
// =============================================================================

/**
 * 컴포넌트 스타일 프리셋
 * Tailwind 클래스 조합으로 정의
 */
export const componentStyles = {
    // 카드/패널 스타일
    card: {
        base: 'rounded-lg border bg-card shadow-sm',
        interactive: 'rounded-lg border bg-card shadow-sm hover:shadow-md transition-shadow cursor-pointer',
        muted: 'rounded-lg bg-muted/30 p-4',
    },

    // 버튼 스타일 (shadcn/ui Button과 보완)
    button: {
        primary: 'bg-[#1f9d57] text-white hover:bg-[#138a48] shadow-sm',
        secondary: 'border border-[rgba(31,157,87,0.3)] bg-white/85 text-[#138a48] hover:bg-[#d6f1e2]',
        ghost: 'text-muted-foreground hover:bg-[rgba(31,157,87,0.08)] hover:text-foreground',
        danger: 'bg-[#d95b5b] text-white hover:bg-[#c54141]',
    },

    // 배지/태그 스타일
    badge: {
        success: 'bg-green-100 text-green-800 border-green-200',
        warning: 'bg-amber-100 text-amber-800 border-amber-200',
        danger: 'bg-red-100 text-red-800 border-red-200',
        info: 'bg-blue-100 text-blue-800 border-blue-200',
        muted: 'bg-slate-100 text-slate-600 border-slate-200',
        primary: 'bg-[#d6f1e2] text-[#138a48] border-[#a8e6cf]',
    },

    // 시간표 블록 스타일
    timetableBlock: {
        base: 'relative m-0.5 rounded p-1 text-xs overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-shadow border-l-4',
        normal: 'bg-[#d6f1e2] border-l-[#1f9d57]',
        conflict: 'bg-red-100 border-l-red-500',
        ghost: 'border-2 border-dashed bg-opacity-50 pointer-events-none',
    },

    // 입력 필드 강조
    input: {
        focus: 'focus:border-[#1f9d57] focus:ring-1 focus:ring-[#1f9d57]/30',
    },

    // 탭 스타일
    tab: {
        list: 'flex items-center gap-1 border-b bg-muted/20 p-1 rounded-t-lg',
        trigger: {
            base: 'px-4 py-2 text-sm font-medium transition-all rounded-md',
            active: 'bg-background text-[#1f9d57] shadow-sm ring-1 ring-border',
            inactive: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        },
    },

    // 테이블 행 스타일
    table: {
        row: {
            base: 'border-b transition-colors',
            hover: 'hover:bg-muted/50',
            selected: 'bg-[#d6f1e2]/50',
            alternate: 'odd:bg-muted/10',
        },
    },

    // 상태 표시
    status: {
        active: 'text-[#1f9d57] bg-[#d6f1e2]',
        inactive: 'text-slate-500 bg-slate-100',
        pending: 'text-amber-600 bg-amber-50',
        error: 'text-red-600 bg-red-50',
    },
} as const;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * 숫자를 화폐 형식으로 포맷합니다.
 */
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: 'KRW',
    }).format(amount);
}

/**
 * 숫자에 천 단위 구분자를 추가합니다.
 */
export function formatNumber(num: number): string {
    return new Intl.NumberFormat('ko-KR').format(num);
}

// =============================================================================
// CSS VARIABLE HELPERS
// =============================================================================

/**
 * CSS 변수 이름을 반환합니다.
 * 예: cssVar('accent') => 'var(--accent)'
 */
export function cssVar(name: string): string {
    return `var(--${name})`;
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ColorKey = keyof typeof colors;
export type ComponentStyleKey = keyof typeof componentStyles;
