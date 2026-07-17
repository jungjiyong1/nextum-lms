import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
    // v3: font-medium → font-semibold
    "inline-flex appearance-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-semibold leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-45",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary-strong focus-visible:bg-primary-strong",
                destructive:
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                outline:
                    "border-border bg-card text-foreground hover:bg-muted focus-visible:border-primary/45",
                secondary:
                    "bg-muted text-foreground hover:bg-secondary focus-visible:border-primary/35",
                ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                link: "h-auto rounded-none border-transparent bg-transparent p-0 text-primary underline-offset-4 hover:underline focus-visible:underline",
            },
            // v3: larger controls — default 40px, lg 46px
            size: {
                default: "h-10 px-4 py-2",
                xs: "h-[30px] px-3 text-xs",
                sm: "h-9 px-3.5",
                lg: "h-[46px] px-[22px] text-base",
                icon: "h-10 w-10",
                "icon-sm": "h-9 w-9",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
