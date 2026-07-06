import * as React from "react"

import { cn } from "../../lib/utils"

interface SelectableCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    selected?: boolean
}

const SelectableCard = React.forwardRef<HTMLButtonElement, SelectableCardProps>(
    ({ className, selected, ...props }, ref) => (
        <button
            ref={ref}
            type="button"
            aria-pressed={selected}
            className={cn(
                "w-full rounded-xl border bg-card p-3 text-left text-sm shadow-sm transition-colors",
                "hover:border-primary/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                selected && "border-primary/45 bg-primary-soft text-foreground shadow-none",
                className
            )}
            {...props}
        />
    )
)
SelectableCard.displayName = "SelectableCard"

export { SelectableCard }
