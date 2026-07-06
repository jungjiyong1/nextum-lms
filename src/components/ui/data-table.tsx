import * as React from "react"

import { cn } from "../../lib/utils"

const DataTable = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
        {...props}
    >
        <div className="overflow-x-auto">{children}</div>
    </div>
))
DataTable.displayName = "DataTable"

const Table = React.forwardRef<
    HTMLTableElement,
    React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
    <table ref={ref} className={cn("w-full text-sm", className)} {...props} />
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("bg-muted/60 text-muted-foreground", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("divide-y divide-border", className)} {...props} />
))
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<
    HTMLTableRowElement,
    React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
    <tr ref={ref} className={cn("transition-colors hover:bg-muted/45", className)} {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
    HTMLTableCellElement,
    React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
    <th
        ref={ref}
        className={cn("whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase", className)}
        {...props}
    />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
    HTMLTableCellElement,
    React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-4 py-3 align-middle text-foreground", className)} {...props} />
))
TableCell.displayName = "TableCell"

export { DataTable, Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
