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
                    "flex h-10 w-full rounded-md border border-transparent !bg-[#e7e5e4] px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#d7ede1] disabled:cursor-not-allowed disabled:opacity-50",
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
