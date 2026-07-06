import * as React from "react"

import { cn } from "../../lib/utils"

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> { }

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, onMouseDown, onPointerDown, onClick, onFocus, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-10 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
                    className
                )}
                ref={ref}
                autoComplete="off"
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
                    // Ensure focus
                    (e.target as HTMLInputElement).focus();
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
Input.displayName = "Input"

export { Input }
