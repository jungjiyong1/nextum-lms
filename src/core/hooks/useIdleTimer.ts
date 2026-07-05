import { useEffect, useRef, useCallback } from 'react';

/**
 * 비활성(Idle) 감지 훅
 * @param timeoutMinutes 비활성 타임아웃 (분 단위)
 * @param onIdle 비활성 상태가 되었을 때 호출되는 콜백
 * @param enabled 비활성 감지 활성화 여부
 */
export function useIdleTimer(
    timeoutMinutes: number,
    onIdle: () => void,
    enabled: boolean = true
) {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onIdleRef = useRef(onIdle);

    // 최신 콜백 참조 유지
    useEffect(() => {
        onIdleRef.current = onIdle;
    }, [onIdle]);

    const resetTimer = useCallback(() => {
        if (!enabled) return;

        // 기존 타이머 취소
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // 새 타이머 시작
        const timeoutMs = timeoutMinutes * 60 * 1000;
        timeoutRef.current = setTimeout(() => {
            onIdleRef.current();
        }, timeoutMs);
    }, [timeoutMinutes, enabled]);

    useEffect(() => {
        if (!enabled) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            return;
        }

        // 감지할 이벤트 목록
        const events = [
            'mousedown',
            'mousemove',
            'keydown',
            'scroll',
            'touchstart',
            'click',
            'wheel'
        ];

        // 이벤트 핸들러
        const handleActivity = () => {
            resetTimer();
        };

        // 이벤트 리스너 등록
        events.forEach(event => {
            document.addEventListener(event, handleActivity, { passive: true });
        });

        // 초기 타이머 시작
        resetTimer();

        // 클린업
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            events.forEach(event => {
                document.removeEventListener(event, handleActivity);
            });
        };
    }, [resetTimer, enabled]);

    // 수동 리셋 함수 반환
    return { resetTimer };
}
