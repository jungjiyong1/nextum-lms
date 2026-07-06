import * as React from "react"

import { cn } from "../../lib/utils"
import { Label } from "./label"

interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
    label?: React.ReactNode
    htmlFor?: string
    description?: React.ReactNode
    error?: React.ReactNode
}

interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    title?: React.ReactNode
    description?: React.ReactNode
}

function FormField({
    label,
    htmlFor,
    description,
    error,
    className,
    children,
    ...props
}: FormFieldProps) {
    return (
        <div className={cn("space-y-1.5", className)} {...props}>
            {label && <Label htmlFor={htmlFor}>{label}</Label>}
            {children}
            {description && !error && <p className="text-xs text-muted-foreground">{description}</p>}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}

function FormSection({
    title,
    description,
    className,
    children,
    ...props
}: FormSectionProps) {
    return (
        <section className={cn("space-y-4 rounded-xl border border-border bg-card p-4", className)} {...props}>
            {(title || description) && (
                <div>
                    {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
                    {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
                </div>
            )}
            {children}
        </section>
    )
}

export { FormField, FormSection }
