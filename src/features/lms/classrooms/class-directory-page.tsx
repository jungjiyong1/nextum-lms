'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, LayoutGrid, Plus, RefreshCw, Search, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageShell } from '@/components/ui/page-shell';
import { SelectField } from '@/components/ui/select-field';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { StatusBadge } from '@/components/ui/status-badge';
import { canManageScheduleRules } from '@/core/auth/roles';
import { useAuth } from '@/contexts/AuthContext';
import { addLmsInvalidationListener, loadClassDirectory } from '../service';
import type { ClassDirectoryPage, ClassSummary } from '../types';
import { useDebouncedValue } from '../use-debounced-value';
import {
  CLASS_DIRECTORY_MAX_RENDERED,
  CLASS_DIRECTORY_PAGE_SIZE,
  classDirectoryHref,
  classSubjectLabel,
  compareClassDirectoryRows,
  parseClassDirectoryQuery,
  primaryClassGrade,
} from './class-directory-query';

type Group = {
  grade: string;
  subjects: Array<{ subject: string; classes: ClassSummary[] }>;
};

function groupClasses(rows: ClassSummary[]): Group[] {
  const grades = new Map<string, Map<string, ClassSummary[]>>();
  for (const row of rows.slice(0, CLASS_DIRECTORY_MAX_RENDERED)) {
    const grade = primaryClassGrade(row);
    const subject = classSubjectLabel(row);
    const subjects = grades.get(grade) || new Map<string, ClassSummary[]>();
    const subjectRows = subjects.get(subject) || [];
    subjectRows.push(row);
    subjects.set(subject, subjectRows);
    grades.set(grade, subjects);
  }
  return [...grades.entries()].map(([grade, subjects]) => ({
    grade,
    subjects: [...subjects.entries()]
      .map(([subject, classes]) => ({ subject, classes: [...classes].sort(compareClassDirectoryRows) }))
      .sort((left, right) => left.subject.localeCompare(right.subject, 'ko-KR')),
  })).sort((left, right) => {
    const leftFirst = left.subjects[0]?.classes[0];
    const rightFirst = right.subjects[0]?.classes[0];
    return leftFirst && rightFirst ? compareClassDirectoryRows(leftFirst, rightFirst) : left.grade.localeCompare(right.grade, 'ko-KR');
  });
}

function statusLabel(value: string): string {
  if (value === 'active') return '운영 중';
  if (value === 'inactive') return '중지';
  if (value === 'archived') return '보관';
  return value;
}

export function ClassDirectoryPageView() {
  const { profile } = useAuth();
  const academyId = profile?.current_academy_id || null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const serializedParams = searchParams.toString();
  const query = useMemo(
    () => parseClassDirectoryQuery(new URLSearchParams(serializedParams)),
    [serializedParams],
  );
  const [searchText, setSearchText] = useState(query.q);
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [data, setData] = useState<ClassDirectoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSearchText(query.q), [query.q]);

  useEffect(() => {
    if (debouncedSearch === query.q) return;
    router.replace(classDirectoryHref({ ...query, q: debouncedSearch, cursor: '' }), { scroll: false });
  }, [debouncedSearch, query, router]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!academyId) {
      setLoading(false);
      setError('현재 계정에 연결된 학원이 없습니다.');
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadClassDirectory(academyId, {
      ...query,
      limit: CLASS_DIRECTORY_PAGE_SIZE,
      signal: controller.signal,
      force: refreshKey > 0,
    })
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '반 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [academyId, query, refreshKey]);

  useEffect(() => {
    if (!academyId) return undefined;
    return addLmsInvalidationListener((payload) => {
      if (payload.academyId && payload.academyId !== academyId) return;
      const domain = payload.domain || payload.domains?.[0] || 'lms';
      if (!['classes', 'students', 'learning', 'lms', 'admin'].includes(domain)) return;
      refresh();
    });
  }, [academyId, refresh]);

  const updateFilter = (key: 'grade' | 'subject' | 'instructor' | 'status', value: string) => {
    router.replace(classDirectoryHref({ ...query, [key]: value, cursor: '' }), { scroll: false });
  };
  const groups = useMemo(() => groupClasses(data?.classes || []), [data?.classes]);
  const canManage = canManageScheduleRules(profile?.role);
  const returnTo = classDirectoryHref(query);

  return (
    <PageShell
      title="반 운영"
      icon={LayoutGrid}
      className="max-w-[1600px]"
      actions={(
        <>
          {canManage && (
            <Button asChild>
              <Link href="/classrooms/settings?newClass=1"><Plus className="mr-2 h-4 w-4" />반 추가</Link>
            </Button>
          )}
          <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />새로고침
          </Button>
        </>
      )}
    >
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 xl:grid-cols-[minmax(240px,2fr)_repeat(4,minmax(140px,1fr))]">
          <label className="relative block">
            <span className="sr-only">반 검색</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="반 이름, 과목, 강사 검색"
              className="pl-9"
            />
          </label>
          <SelectField value={query.grade} onChange={(event) => updateFilter('grade', event.target.value)} aria-label="대상 학년">
            <option value="">전체 학년</option>
            {data?.facets.grades.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}
          </SelectField>
          <SelectField value={query.subject} onChange={(event) => updateFilter('subject', event.target.value)} aria-label="과목">
            <option value="">전체 과목</option>
            {data?.facets.subjects.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}
          </SelectField>
          <SelectField value={query.instructor} onChange={(event) => updateFilter('instructor', event.target.value)} aria-label="강사">
            <option value="">전체 강사</option>
            {data?.facets.instructors.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}
          </SelectField>
          <SelectField value={query.status} onChange={(event) => updateFilter('status', event.target.value)} aria-label="운영 상태">
            <option value="active">운영 중</option>
            <option value="inactive">중지</option>
            <option value="archived">보관</option>
            <option value="all">전체 상태</option>
          </SelectField>
        </CardContent>
      </Card>

      {loading && <SkeletonPanel className="min-h-[420px]" rows={8} />}
      {!loading && error && <ErrorState title="반 목록을 불러오지 못했습니다" description={error} onRetry={refresh} />}
      {!loading && !error && data && data.classes.length === 0 && (
        <EmptyState
          title="조건에 맞는 반이 없습니다"
          description="검색어나 필터를 바꾸거나 새 반을 추가해 주세요."
          action={canManage ? <Button asChild><Link href="/classrooms/settings?newClass=1">반 추가</Link></Button> : undefined}
        />
      )}
      {!loading && !error && data && data.classes.length > 0 && (
        <div className="space-y-7" aria-label="대상 학년과 과목별 반 목록">
          <div className="text-sm text-muted-foreground">
            검색 결과 <span className="font-semibold text-foreground">{data.totalCount.toLocaleString('ko-KR')}</span>개
          </div>
          {groups.map((group) => (
            <section key={group.grade} aria-labelledby={`grade-${group.grade}`} className="space-y-4 [content-visibility:auto] [contain-intrinsic-size:0_420px]">
              <h2 id={`grade-${group.grade}`} className="text-xl font-bold text-foreground">{group.grade}</h2>
              <div className="space-y-5 border-l-2 border-border pl-4 sm:pl-5">
                {group.subjects.map((subjectGroup) => (
                  <section key={subjectGroup.subject} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
                      <h3 className="font-semibold text-foreground">{subjectGroup.subject}</h3>
                      <span className="text-xs text-muted-foreground">{subjectGroup.classes.length}개</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                      {subjectGroup.classes.map((row) => (
                        <Link
                          key={row.id}
                          href={`/classrooms/${encodeURIComponent(row.id)}/schedule?returnTo=${encodeURIComponent(returnTo)}`}
                          className="group flex min-h-24 items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 no-underline transition-colors hover:border-primary/40 hover:bg-primary-soft/30"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color || 'hsl(var(--muted-foreground))' }} />
                              <span className="truncate font-semibold text-foreground group-hover:text-primary-strong">{row.name}</span>
                              {row.targetGrades && row.targetGrades.length > 1 && <StatusBadge label="혼합" tone="info" />}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />학생 {row.studentCount}명</span>
                              <span>{row.instructors?.map((item) => item.name).join(', ') || row.instructorName || '강사 미설정'}</span>
                              {row.courseTitle && <span>{row.courseTitle}</span>}
                            </div>
                          </div>
                          <StatusBadge status={row.status} label={statusLabel(row.status)} />
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
          <div className="flex items-center justify-center gap-2 border-t border-border pt-5">
            {query.cursor && (
              <Button type="button" variant="outline" onClick={() => router.replace(classDirectoryHref({ ...query, cursor: '' }), { scroll: false })}>
                처음 결과
              </Button>
            )}
            {data.hasMore && data.nextCursor && (
              <Button type="button" onClick={() => router.replace(classDirectoryHref({ ...query, cursor: data.nextCursor || '' }), { scroll: false })}>
                다음 {CLASS_DIRECTORY_PAGE_SIZE}개
              </Button>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
