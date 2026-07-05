import { START_MINUTES, SLOT_MINUTES, SLOT_COUNT } from '../constants';
import { clamp } from './dom';

export function timeToMinutes(time: string): number {
  const [hourStr, minuteStr] = time.split(':');
  const hours = Number(hourStr);
  const minutes = Number(minuteStr);
  return hours * 60 + minutes;
}

export function timeToSlot(time: string): number {
  const minutes = timeToMinutes(time) - START_MINUTES;
  const rawSlot = Math.round(minutes / SLOT_MINUTES);
  return clamp(rawSlot, 0, SLOT_COUNT);
}

export function slotToTime(slot: number): string {
  const total = START_MINUTES + slot * SLOT_MINUTES;
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}
