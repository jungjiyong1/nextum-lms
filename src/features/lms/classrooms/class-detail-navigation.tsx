'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import { cn } from '@/lib/utils';

export type ClassDetailSection = 'schedule' | 'students' | 'learning' | 'materials' | 'settings';

const sections: Array<{ id: ClassDetailSection; label: string }> = [
  { id: 'schedule', label: '시간표' },
  { id: 'students', label: '학생' },
  { id: 'learning', label: '학습 경로' },
  { id: 'materials', label: '교재' },
  { id: 'settings', label: '설정' },
];

export function classDetailHref(classId: string, section: ClassDetailSection, returnTo?: string | null): string {
  const pathname = `/classrooms/${encodeURIComponent(classId)}/${section}`;
  return returnTo ? `${pathname}?returnTo=${encodeURIComponent(returnTo)}` : pathname;
}

export function ClassDetailNavigation({ classId, children }: { classId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = sections.find((item) => pathname.endsWith(`/${item.id}`))?.id || 'schedule';
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo = requestedReturnTo?.startsWith('/classrooms') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/classrooms';

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-5 py-3 backdrop-blur lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={returnTo}><ArrowLeft className="mr-1 h-4 w-4" />반 목록</Link>
          </Button>
          <SelectField
            value={activeSection}
            onChange={(event) => router.push(classDetailHref(classId, event.target.value as ClassDetailSection, returnTo))}
            aria-label="반 상세 메뉴"
            className="ml-auto max-w-48 md:hidden"
          >
            {sections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </SelectField>
          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="반 상세 메뉴">
            {sections.map((item) => {
              const active = item.id === activeSection;
              return (
                <Link
                  key={item.id}
                  href={classDetailHref(classId, item.id, returnTo)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground',
                    active && 'bg-primary-soft text-primary-strong',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
