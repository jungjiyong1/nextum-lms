import * as React from "react"

import { cn } from "../../lib/utils"

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary"

interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    status?: string | null
    label?: React.ReactNode
    tone?: StatusTone
    /** v3 triple-coding: color + icon + text. Set false to hide the glyph. */
    icon?: boolean
}

const statusToneMap: Record<string, StatusTone> = {
    active: "success",
    ok: "success",
    present: "success",
    paid: "success",
    completed: "success",
    success: "success",
    issued: "warning",
    partial: "warning",
    late: "warning",
    makeup: "warning",
    watch: "warning",
    pending: "warning",
    weak: "danger",
    absent: "danger",
    dropped: "danger",
    failed: "danger",
    overdue: "danger",
    error: "danger",
    inactive: "neutral",
    on_leave: "neutral",
    graduated: "neutral",
    insufficient: "neutral",
    excused: "neutral",
    not_issued: "neutral",
    draft: "neutral",
}

const statusLabelMap: Record<string, React.ReactNode> = {
    active: "재원",
    inactive: "중지",
    on_leave: "휴원",
    graduated: "졸업",
    dropped: "퇴원/보관",
    archived: "보관",
    ok: "양호",
    weak: "취약",
    watch: "주의",
    insufficient: "표본 부족",
    present: "출석",
    late: "지각",
    absent: "결석",
    excused: "인정 결석",
    makeup: "보강",
    scheduled: "예정",
    completed: "완료",
    cancelled: "취소",
    substitute: "대강",
    issued: "청구",
    paid: "완납",
    partial: "부분 납부",
    not_issued: "미발행",
    overdue: "연체",
    pending: "대기",
    refunded: "환불",
    failed: "실패",
    draft: "초안",
    success: "성공",
    error: "오류",
}

const toneClasses: Record<StatusTone, string> = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-success-soft text-success-foreground",
    warning: "bg-warning-soft text-warning-foreground",
    danger: "bg-destructive-soft text-destructive",
    info: "bg-info-soft text-info-foreground",
    primary: "bg-primary-soft text-primary-strong",
}

/* v3 triple-coding glyphs (check / triangle / circle) — meaning never relies
   on color alone, for first-time and color-blind users. */
const toneIcon: Record<StatusTone, React.ReactNode> = {
    success: <path d="M20 6 9 17l-5-5" />,
    warning: (
        <>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
        </>
    ),
    danger: (
        <>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
        </>
    ),
    primary: (
        <>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
        </>
    ),
    neutral: <circle cx="12" cy="12" r="4" />,
}

function toneForStatus(status: string | null | undefined): StatusTone {
    if (!status) return "neutral"
    return statusToneMap[status] || "neutral"
}

function StatusBadge({
    status,
    label,
    tone,
    icon = true,
    className,
    ...props
}: StatusBadgeProps) {
    const resolvedTone = tone || toneForStatus(status)

    return (
        <span
            className={cn(
                "inline-flex items-center gap-[5px] rounded-full px-[11px] py-[5px] text-xs font-bold leading-none",
                toneClasses[resolvedTone],
                className
            )}
            {...props}
        >
            {icon && (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-[13px] w-[13px] shrink-0"
                    aria-hidden="true"
                >
                    {toneIcon[resolvedTone]}
                </svg>
            )}
            {label ?? (status ? statusLabelMap[status] ?? status : "-")}
        </span>
    )
}

export { StatusBadge, toneForStatus, type StatusTone }
