import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { App } from '@/App';
import './globals.css';

export const metadata: Metadata = {
    title: 'NEXTUM LMS',
    description: 'NEXTUM LMS web application',
    icons: {
        icon: '/icon.png',
        shortcut: '/icon.png',
        apple: '/icon.png',
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: ReactNode;
}>) {
    return (
        <html lang="ko">
            <body>
                <App>{children}</App>
            </body>
        </html>
    );
}
