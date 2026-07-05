// 앱 상수 정의
import type { Day } from './types';

export const ALL_DAYS: Day[] = [
  { index: 0, label: '월' },
  { index: 1, label: '화' },
  { index: 2, label: '수' },
  { index: 3, label: '목' },
  { index: 4, label: '금' },
  { index: 5, label: '토' },
  { index: 6, label: '일' },
];

export const START_MINUTES = 9 * 60; // 09:00
export const END_MINUTES = 24 * 60; // 24:00
export const SLOT_MINUTES = 30;
export const SLOT_COUNT = Math.floor((END_MINUTES - START_MINUTES) / SLOT_MINUTES);

export const MIN_ROOM_SIZE_PX = 24;
export const GRID_SIZE_PX = 20;
export const LESSON_DRAG_THRESHOLD = 6;
