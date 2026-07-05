export function getWeekStart(date: Date = new Date()): Date {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayIndex = (local.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  local.setDate(local.getDate() - dayIndex);
  return local;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function getDayIndex(dateStr: string): number {
  const date = parseDate(dateStr);
  return (date.getDay() + 6) % 7;
}

export function getWeekRange(weekStart: string): { startDate: string; endDate: string } {
  const start = parseDate(weekStart);
  const end = addDays(start, 6);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}
