'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { jsonCsrfHeaders } from '@/lib/lms/csrf-client';
import {
  buildLearningAnalysisAssignmentDraft,
  saveLearningAnalysisAssignmentDraft,
} from '@/lib/lms/learning-analysis-draft';
import type {
  CreateLearningPlanInput,
  LearningAnalysisData,
  LearningAnalysisTab,
} from './learning-analysis-types';
import { LearningAnalysisView } from './learning-analysis-view';

interface LearningAnalysisClientProps {
  initialTab?: LearningAnalysisTab;
  initialPlanId?: string | null;
  initialClassId?: string | null;
}

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: unknown;
};

function apiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

async function readEnvelope<T>(response: Response, fallback: string): Promise<T> {
  const envelope = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope?.success || envelope.data === undefined) {
    throw new Error(apiErrorMessage(envelope?.error, fallback));
  }
  return envelope.data;
}

async function ensureMutationSuccess(response: Response, fallback: string): Promise<void> {
  const envelope = await response.json().catch(() => null) as ApiEnvelope<unknown> | null;
  if (!response.ok || !envelope?.success) {
    throw new Error(apiErrorMessage(envelope?.error, fallback));
  }
}

export function LearningAnalysisClient({
  initialTab = 'class-learning',
  initialPlanId = null,
  initialClassId = null,
}: LearningAnalysisClientProps) {
  const { profile } = useAuth();
  const router = useRouter();
  const routeSearchParams = useSearchParams();
  const academyId = profile?.current_academy_id ?? null;
  const [data, setData] = useState<LearningAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExamPlanId, setSelectedExamPlanId] = useState<string | null>(initialPlanId);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setData((current) => current ? { ...current, examStudents: [] } : current);
    setSelectedExamPlanId(initialPlanId);
  }, [initialPlanId]);

  useEffect(() => {
    if (!academyId) {
      setLoading(false);
      setError('현재 계정에 연결된 학원이 없습니다.');
      setData(null);
      return undefined;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ academyId });
    if (selectedExamPlanId) params.set('planId', selectedExamPlanId);
    if (initialClassId) params.set('classId', initialClassId);

    setLoading(true);
    setError(null);
    void fetch(`/api/lms/learning-analysis?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => readEnvelope<LearningAnalysisData>(response, '학습 경로를 불러오지 못했습니다.'))
      .then((nextData) => {
        if (controller.signal.aborted) return;
        setData(nextData);
        setSelectedExamPlanId((current) => {
          if (current && nextData.examPlans.some((plan) => plan.id === current)) return current;
          return nextData.examPlans[0]?.id ?? null;
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '학습 경로를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [academyId, initialClassId, refreshKey, selectedExamPlanId]);

  const selectExamPlan = (planId: string) => {
    setLoading(true);
    setData((current) => current ? { ...current, examStudents: [] } : current);
    setSelectedExamPlanId(planId);
    const params = new URLSearchParams(routeSearchParams.toString());
    params.set('planId', planId);
    router.replace(
      initialClassId
        ? `/classrooms/${encodeURIComponent(initialClassId)}/learning?${params.toString()}`
        : `/learning/exams?${params.toString()}`,
      { scroll: false },
    );
  };

  const submitPlan = async (input: CreateLearningPlanInput) => {
    if (!academyId) throw new Error('현재 계정에 연결된 학원이 없습니다.');
    const response = await fetch('/api/lms/learning-analysis', {
      method: 'POST',
      headers: jsonCsrfHeaders(),
      body: JSON.stringify({ academyId, input }),
    });
    await ensureMutationSuccess(response, '학습 계획을 저장하지 못했습니다.');
    toast.success('학습 경로를 저장했습니다.');
    setRefreshKey((current) => current + 1);
  };

  const startPath = async (planId: string) => {
    if (!academyId) throw new Error('현재 계정에 연결된 학원이 없습니다.');
    const response = await fetch('/api/lms/learning-analysis', {
      method: 'PATCH',
      headers: jsonCsrfHeaders(),
      body: JSON.stringify({ academyId, planId, action: 'start' }),
    });
    await ensureMutationSuccess(response, '다음 학습 경로를 시작하지 못했습니다.');
    toast.success('다음 대표 학습 경로를 시작했습니다.');
    setRefreshKey((current) => current + 1);
  };

  const changePathStatus = async (planId: string, action: 'complete' | 'archive') => {
    if (!academyId) throw new Error('현재 계정에 연결된 학원이 없습니다.');
    const response = await fetch('/api/lms/learning-analysis', {
      method: 'PATCH',
      headers: jsonCsrfHeaders(),
      body: JSON.stringify({ academyId, planId, action }),
    });
    await ensureMutationSuccess(response, '학습 경로 상태를 변경하지 못했습니다.');
    toast.success(action === 'complete' ? '학습 경로를 완료했습니다.' : '학습 경로를 보관했습니다.');
    setRefreshKey((current) => current + 1);
  };

  const createAssignmentDraft = async (actionIds: string[]) => {
    if (!data) throw new Error('학습 분석 데이터를 먼저 불러와 주세요.');
    const selected = data.actionQueue.filter((item) => actionIds.includes(item.id));
    if (selected.length !== actionIds.length) {
      throw new Error('일부 조치 항목이 갱신되었습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.');
    }

    const draft = buildLearningAnalysisAssignmentDraft(selected.map((item) => ({
      id: item.id,
      studentId: item.studentId,
      skillId: item.skillId,
      skillName: item.skillName,
    })));
    saveLearningAnalysisAssignmentDraft(window.sessionStorage, draft);
    toast.success('학생과 유형을 과제 초안으로 옮겼습니다. 문제 범위를 검토해 주세요.');
    router.push('/assignments/new?source=learning-analysis');
  };

  return (
    <LearningAnalysisView
      data={data}
      loading={loading}
      error={error}
      initialTab={initialTab}
      selectedExamPlanId={selectedExamPlanId}
      onRetry={() => setRefreshKey((current) => current + 1)}
      onSelectedExamPlanChange={selectExamPlan}
      onSubmitPlan={submitPlan}
      onStartPath={startPath}
      onChangePathStatus={changePathStatus}
      onCreateAssignmentDraft={createAssignmentDraft}
    />
  );
}
