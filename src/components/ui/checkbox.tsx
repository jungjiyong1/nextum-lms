import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"

import { cn } from "../../lib/utils"

const Checkbox = React.forwardRef<
    React.ElementRef<typeof CheckboxPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
            "h-5 w-5 shrink-0 appearance-none rounded-md border border-input bg-card transition-colors",
            "hover:border-primary/60",
            "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:border-primary focus-visible:outline-none",
            className
        )}
        {...props}
    >
        <CheckboxPrimitive.Indicator
            className="flex items-center justify-center text-primary-foreground"
        >
            <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
            >
                <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
            </svg>
        </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
