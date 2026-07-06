import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "../../lib/utils"
import { Card, CardContent } from "./card"

type StatTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info"

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
    label: React.ReactNode
    value: React.ReactNode
    hint?: React.ReactNode
    icon?: LucideIcon | React.ComponentType<{ className?: string }>
    tone?: StatTone
}

const toneClass: Record<StatTone, string> = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success-foreground",
    warning: "bg-warning-soft text-warning-foreground",
    danger: "bg-destructive/10 text-destructive",
    info: "bg-info-soft text-info-foreground",
}

function StatCard({
    label,
    value,
    hint,
    icon: Icon,
    tone = "neutral",
    className,
    ...props
}: StatCardProps) {
    return (
        <Card className={cn("overflow-hidden", className)} {...props}>
            <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="mt-1 truncate text-2xl font-bold text-foreground">{value}</p>
                    {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
                </div>
                {Icon && (
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", toneClass[tone])}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export { StatCard, type StatTone }
