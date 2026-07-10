'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectField } from '@/components/ui/select-field';
import { EmptyState } from '@/components/ui/state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { changeClassMembers, loadClassMemberCandidates } from '../service';
import type {
  BillingClassRuleType,
  ClassMemberCandidate,
  ClassStudentSummary,
} from '../types';
import { dateValue } from './schedule-utils';

type BillingDraft = { ruleType: BillingClassRuleType; amount: string };

function defaultBilling(candidate: ClassMemberCandidate): BillingDraft {
  if (candidate.billingMode === 'usage_based') {
    return { ruleType: 'usage_based', amount: String(candidate.hourlyRate || 0) };
  }
  if (candidate.classNames.length === 0 || candidate.billingMode === 'manual') {
    return { ruleType: 'included', amount: '0' };
  }
  return { ruleType: 'extra_flat', amount: '0' };
}

export function ClassMemberDialog({
  open,
  onOpenChange,
  academyId,
  classId,
  className,
  capacity,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academyId: string;
  classId: string;
  className: string;
  capacity: number | null;
  members: ClassStudentSummary[];
  onSaved: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState('add');
  const [query, setQuery] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(dateValue(new Date()));
  const [candidates, setCandidates] = useState<ClassMemberCandidate[]>([]);
  const [candidateCache, setCandidateCache] = useState<Record<string, ClassMemberCandidate>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedAdds, setSelectedAdds] = useState<Set<string>>(new Set());
  const [selectedRemoves, setSelectedRemoves] = useState<Set<string>>(new Set());
  const [billing, setBilling] = useState<Record<string, BillingDraft>>({});

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void loadClassMemberCandidates(academyId, classId, query, { signal: controller.signal, force: true })
        .then((rows) => {
          setCandidates(rows);
          setCandidateCache((current) => ({
            ...current,
            ...Object.fromEntries(rows.map((row) => [row.studentId, row])),
          }));
          setBilling((current) => {
            const next = { ...current };
            for (const row of rows) if (!next[row.studentId]) next[row.studentId] = defaultBilling(row);
            return next;
          });
        })
        .catch((error) => {
          if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : '학생을 검색하지 못했습니다.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [academyId, classId, open, query]);

  useEffect(() => {
    if (open) return;
    setTab('add');
    setQuery('');
    setSelectedAdds(new Set());
    setSelectedRemoves(new Set());
    setCandidateCache({});
  }, [open]);

  const activeMembers = useMemo(() => members.filter((member) => member.status === 'active'), [members]);
  const nextCount = activeMembers.length + selectedAdds.size - selectedRemoves.size;
  const overCapacity = capacity !== null && nextCount > capacity;

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    const changes = [
      ...[...selectedAdds].map((studentId) => candidateCache[studentId]).filter((candidate): candidate is ClassMemberCandidate => Boolean(candidate)).map((candidate) => {
        const draft = billing[candidate.studentId] || defaultBilling(candidate);
        return {
          studentId: candidate.studentId,
          action: 'add' as const,
          billingRule: { ruleType: draft.ruleType, amount: Number(draft.amount) || 0 },
        };
      }),
      ...activeMembers.filter((member) => selectedRemoves.has(member.id)).map((member) => ({
        studentId: member.id,
        action: 'remove' as const,
        billingRule: null,
      })),
    ];
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await changeClassMembers(academyId, { classId, effectiveDate, changes });
      toast.success(`학생 배정을 ${changes.length}건 반영했습니다.`);
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '학생 배정을 변경하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{className} 학생 배정</DialogTitle>
          <DialogDescription>반 배정과 해당 학생의 청구 적용 규칙을 같은 적용일로 변경합니다.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="학생 이름 검색" className="pl-9" />
          </div>
          <div>
            <Label htmlFor="member-effective-date">적용일</Label>
            <Input id="member-effective-date" type="date" max={dateValue(new Date())} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} variant="underline">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="add"><UserPlus className="mr-2 h-4 w-4" />학생 추가 {selectedAdds.size > 0 && `(${selectedAdds.size})`}</TabsTrigger>
            <TabsTrigger value="remove"><UserMinus className="mr-2 h-4 w-4" />학생 제외 {selectedRemoves.size > 0 && `(${selectedRemoves.size})`}</TabsTrigger>
          </TabsList>
          <TabsContent value="add" className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {candidates.map((candidate) => {
              const draft = billing[candidate.studentId] || defaultBilling(candidate);
              const selected = selectedAdds.has(candidate.studentId);
              const hasBillingContract = candidate.billingMode !== null;
              return (
                <div key={candidate.studentId} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox checked={selected} disabled={!hasBillingContract} onCheckedChange={() => toggle(setSelectedAdds, candidate.studentId)} aria-label={`${candidate.name} 추가`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{candidate.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{candidate.grade || '학년 미지정'} · {candidate.classNames.join(', ') || '배정 반 없음'}</p>
                      {!hasBillingContract && <p className="mt-1 text-xs text-warning-foreground">학생 관리에서 청구 계약을 먼저 설정해야 합니다.</p>}
                    </div>
                  </div>
                  {selected && (
                    <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
                      <div>
                        <Label>청구 규칙</Label>
                        <SelectField value={draft.ruleType} onChange={(event) => setBilling((current) => ({ ...current, [candidate.studentId]: { ...draft, ruleType: event.target.value as BillingClassRuleType } }))}>
                          <option value="included">기본료에 포함</option>
                          <option value="extra_flat">추가 정액</option>
                          <option value="usage_based">시간제</option>
                          <option value="discount">할인</option>
                        </SelectField>
                      </div>
                      <div>
                        <Label>금액</Label>
                        <Input type="number" min="0" value={draft.amount} onChange={(event) => setBilling((current) => ({ ...current, [candidate.studentId]: { ...draft, amount: event.target.value } }))} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && candidates.length === 0 && <EmptyState title="추가할 학생이 없습니다" description="검색어를 바꾸거나 학생 관리에서 학생을 먼저 등록하세요." />}
            {loading && <p className="py-8 text-center text-sm text-muted-foreground">학생을 불러오는 중입니다.</p>}
          </TabsContent>
          <TabsContent value="remove" className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {activeMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <Checkbox checked={selectedRemoves.has(member.id)} onCheckedChange={() => toggle(setSelectedRemoves, member.id)} aria-label={`${member.name} 제외`} />
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{member.primaryClass ? '주 반' : '추가 반'} · 제외일부터 청구 규칙 종료</p>
                </div>
              </div>
            ))}
            {activeMembers.length === 0 && <EmptyState title="배정된 학생이 없습니다" />}
          </TabsContent>
        </Tabs>

        <div className={overCapacity ? 'rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-foreground' : 'rounded-lg bg-muted p-3 text-sm text-muted-foreground'}>
          변경 후 {nextCount}명{capacity === null ? '' : ` / 정원 ${capacity}명`}
          {overCapacity && ' · 정원을 초과하지만 확인 후 저장할 수 있습니다.'}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || selectedAdds.size + selectedRemoves.size === 0 || !effectiveDate}>
            {saving ? '저장 중…' : `변경 ${selectedAdds.size + selectedRemoves.size}건 저장`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
