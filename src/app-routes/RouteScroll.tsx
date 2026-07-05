'use client';

import React from 'react';

export function RouteScroll({ children }: { children: React.ReactNode }) {
    return (
        <div className="h-full w-full overflow-y-auto overflow-x-hidden p-0">
            {children}
        </div>
    );
}
