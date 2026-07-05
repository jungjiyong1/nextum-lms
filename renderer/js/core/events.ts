export type DataChangeScope =
  | 'lessons'
  | 'students'
  | 'instructors'
  | 'accounting'
  | 'enrollments'
  | 'schedules'
  | 'classrooms'
  | 'settings'
  | 'general';

export type DataChangeEventDetail = {
  scope: DataChangeScope;
};

type DataChangeHandler = (detail: DataChangeEventDetail) => void;

const appEvents = new EventTarget();

export function emitDataChange(scope: DataChangeScope): void {
  appEvents.dispatchEvent(
    new CustomEvent<DataChangeEventDetail>('datachange', {
      detail: { scope },
    })
  );
}

export function onDataChange(handler: DataChangeHandler): () => void {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<DataChangeEventDetail>;
    handler(custom.detail);
  };
  appEvents.addEventListener('datachange', listener);
  return () => appEvents.removeEventListener('datachange', listener);
}
