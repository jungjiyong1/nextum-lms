import * as React from "react"

import { cn } from "../../lib/utils"

export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { }

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, onMouseDown, onPointerDown, onClick, onFocus, ...props }, ref) => {
        return (
            <textarea
                className={cn(
                    "flex min-h-[88px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
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
