import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Inbox } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "./button"

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    icon?: LucideIcon
    title: React.ReactNode
    description?: React.ReactNode
    action?: React.ReactNode
}

interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    title?: React.ReactNode
    description?: React.ReactNode
    retryLabel?: React.ReactNode
    onRetry?: () => void
}

function EmptyState({
    icon: Icon = Inbox,
    title,
    description,
    action,
    className,
    ...props
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center",
                className
            )}
            {...props}
        >
            <Icon className="h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
            <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            {action}
        </div>
    )
}

function ErrorState({
    title = "Something went wrong.",
    description,
    retryLabel = "Retry",
    onRetry,
    className,
    ...props
}: ErrorStateProps) {
    return (
        <div
            className={cn(
                "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-8 text-center",
                className
            )}
            {...props}
        >
            <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <div>
                <p className="text-sm font-medium text-destructive">{title}</p>
                {description && <p className="mt-1 text-sm text-destructive/80">{description}</p>}
            </div>
            {onRetry && (
                <Button type="button" variant="outline" onClick={onRetry}>
                    {retryLabel}
                </Button>
            )}
        </div>
    )
}

export { EmptyState, ErrorState }
