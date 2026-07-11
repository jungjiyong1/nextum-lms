import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "./button"

type PageStatusTone = "neutral" | "success" | "warning" | "danger" | "info"

interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string
    icon?: LucideIcon
    action?: React.ReactNode
    actions?: React.ReactNode
    status?: React.ReactNode
}

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string
    icon?: LucideIcon
    actions?: React.ReactNode
}

interface PageStatusBarProps extends React.HTMLAttributes<HTMLDivElement> {
    tone?: PageStatusTone
    action?: React.ReactNode
}

const toneStyles: Record<PageStatusTone, string> = {
    neutral: "border-border bg-card text-muted-foreground",
    success: "border-success/30 bg-success-soft text-success-foreground",
    warning: "border-warning/30 bg-warning-soft text-warning-foreground",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    info: "border-info/30 bg-info-soft text-info-foreground",
}

function PageHeader({
    title,
    icon: Icon,
    actions,
    className,
    ...props
}: PageHeaderProps) {
    return (
        <div
            className={cn(
                "flex flex-col gap-4 pb-1 lg:flex-row lg:items-center lg:justify-between",
                className
            )}
            {...props}
        >
            <div className="flex min-w-0 items-center gap-3">
                {Icon && (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                )}
                <h1 className="min-w-0 truncate text-2xl font-bold text-foreground">{title}</h1>
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
    )
}

function PageStatusBar({
    tone = "neutral",
    action,
    className,
    children,
    ...props
}: PageStatusBarProps) {
    return (
        <div
            className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm",
                toneStyles[tone],
                className
            )}
            {...props}
        >
            <div className="min-w-0">{children}</div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}

function PageShell({
    title,
    icon,
    action,
    actions,
    status,
    children,
    className,
    ...props
}: PageShellProps) {
    return (
        <div className={cn("mx-auto flex w-full max-w-7xl flex-col gap-5 p-5 lg:p-8", className)} {...props}>
            <PageHeader title={title} icon={icon} actions={actions ?? action} />
            {status}
            {children}
        </div>
    )
}

function RefreshStatus({
    children,
    onRefresh,
}: {
    children: React.ReactNode
    onRefresh?: () => void
}) {
    return (
        <PageStatusBar
            tone="warning"
            action={onRefresh ? (
                <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
                    Refresh
                </Button>
            ) : undefined}
        >
            {children}
        </PageStatusBar>
    )
}

export { PageShell, PageHeader, PageStatusBar, RefreshStatus }
