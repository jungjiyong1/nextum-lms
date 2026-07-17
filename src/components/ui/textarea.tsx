import * as React from "react"

import { cn } from "../../lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, onMouseDown, onPointerDown, onClick, onFocus, ...props }, ref) => {
        return (
            <textarea
                className={cn(
                    // v3: focus = primary border tint + 3px soft ring shadow
                    "flex min-h-[88px] w-full appearance-none rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-border focus-visible:border-primary/60 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.15)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
                    className
                )}
                ref={ref}
                tabIndex={0}
                onMouseDown={(e) => {
                    e.stopPropagation();
                    onMouseDown?.(e);
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    onPointerDown?.(e);
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    (e.target as HTMLTextAreaElement).focus();
                    onClick?.(e);
                }}
                onFocus={(e) => {
                    e.stopPropagation();
                    onFocus?.(e);
                }}
                {...props}
            />
        )
    }
)
Textarea.displayName = "Textarea"

export { Textarea }
