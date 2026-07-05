import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
// Import pointer safety to prevent input focus bugs
import './pointer-safety';
// Import API to initialize window.api shim for Supabase
import './core/api';
// Import tailwind styles if needed or handled by html link (it is in html)

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </React.StrictMode>
    );
} else {
    console.error('Failed to find root element');
}
