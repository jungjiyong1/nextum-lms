/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

afterEach(cleanup);

describe('Tabs', () => {
    it('switches content without an animation runtime', () => {
        render(
            <Tabs defaultValue="overview">
                <TabsList>
                    <TabsTrigger value="overview">개요</TabsTrigger>
                    <TabsTrigger value="students">학생</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">개요 내용</TabsContent>
                <TabsContent value="students">학생 내용</TabsContent>
            </Tabs>,
        );

        expect(screen.getByText('개요 내용')).toBeInTheDocument();
        const studentsTab = screen.getByRole('tab', { name: '학생' });
        fireEvent.mouseDown(studentsTab, { button: 0 });
        fireEvent.click(studentsTab);

        expect(studentsTab).toHaveAttribute('data-state', 'active');
        expect(screen.getByText('학생 내용')).toBeInTheDocument();
    });
});
