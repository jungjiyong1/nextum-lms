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
                "w-full appearance-none rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors",
                "hover:bg-muted/50 focus-visible:border-primary/45 focus-visible:outline-none",
                selected && "border-primary/45 bg-primary-soft text-foreground",
                className
            )}
            {...props}
        />
    )
)
SelectableCard.displayName = "SelectableCard"

export { SelectableCard }
