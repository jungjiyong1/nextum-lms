const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listClassrooms: () => ipcRenderer.invoke('classrooms:list'),
  createClassroom: (rect) => ipcRenderer.invoke('classrooms:create', rect),
  updateClassroomPosition: (id, x, y) =>
    ipcRenderer.invoke('classrooms:update-position', { id, x, y }),
  updateClassroomRect: (id, x, y, width, height) =>
    ipcRenderer.invoke('classrooms:update-rect', { id, x, y, width, height }),
  renameClassroom: (id, name) =>
    ipcRenderer.invoke('classrooms:rename', { id, name }),
  deleteClassroom: (id) => ipcRenderer.invoke('classrooms:delete', id),
  resetClassrooms: () => ipcRenderer.invoke('classrooms:reset'),
  getTimetable: (classroomId) => ipcRenderer.invoke('timetable:get', classroomId),
  setSlot: (classroomId, day, slot, active) =>
    ipcRenderer.invoke('timetable:set', { classroomId, day, slot, active }),
  listLessons: (classroomId) => ipcRenderer.invoke('lessons:list', classroomId),
  createLesson: (payload) => ipcRenderer.invoke('lessons:create', payload),
  updateLesson: (payload) => ipcRenderer.invoke('lessons:update', payload),
  deleteLesson: (id) => ipcRenderer.invoke('lessons:delete', id)
});
