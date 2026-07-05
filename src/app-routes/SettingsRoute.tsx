'use client';

import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { RouteScroll } from './RouteScroll';

export function SettingsRoute() {
    return (
        <RouteScroll>
            <SettingsPanel />
        </RouteScroll>
    );
}
