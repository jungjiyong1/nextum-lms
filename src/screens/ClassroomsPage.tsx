import React, { useEffect, useRef, useState } from 'react';
import { useLessonStore } from '../stores/lessonStore';
import { useClassroomStore } from '../stores/classroomStore';
import { ClassroomBoard } from '../components/lessons/ClassroomBoard';
import { TimetableGrid } from '../components/lessons/TimetableGrid';
import { MultiView, MultiViewRef } from '../components/lessons/MultiView';
import { LessonDialog, LessonDialogRef } from '../components/lessons/LessonDialog';
import { LessonStudentDialog } from '../components/lessons/LessonStudentDialog';
import * as api from '../core/api';
import { getWeekRange, formatDate, getWeekStart } from '../core/utils/date';
import { emitDataChange, onDataChange } from '../core/events';
import { logger } from '../core/logger';
import { cn } from '../lib/utils';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '../components/ui/checkbox';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import type { ScheduleLesson } from '../core/types';
import { ContextMenu, ContextMenuItem } from '../components/ui/context-menu';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Edit, Trash2 } from 'lucide-react';

export function ClassroomsPage() {
    // Stores
    const viewMode = useLessonStore(state => state.viewMode);
    const includeWeekend = useLessonStore(state => state.includeWeekend);
    const setIncludeWeekend = useLessonStore(state => state.setIncludeWeekend);
    const setViewMode = useLessonStore(state => state.setViewMode);

    const editMode = useClassroomStore(state => state.editMode);
    const selectedId = useClassroomStore(state => state.selectedId);
    const classrooms = useClassroomStore(state => state.classrooms);
    const toggleEditMode = useClassroomStore(state => state.toggleEditMode);
    const selectClassroom = useClassroomStore(state => state.selectClassroom);
    const updateClassroom = useClassroomStore(state => state.updateClassroom);
    const removeClassroom = useClassroomStore(state => state.removeClassroom);

    // Refs
    const multiViewRef = useRef<MultiViewRef>(null);
    const lessonDialogRef = useRef<LessonDialogRef>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Local State
    const [searchValue, setSearchValue] = useState('');
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [renameName, setRenameName] = useState('');
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: number } | null>(null);
    const [boardCollapsed, setBoardCollapsed] = useState(() => {
        const saved = localStorage.getItem('classrooms-board-collapsed');
        return saved === 'true';
    });

    // Persist board collapsed state
    useEffect(() => {
        localStorage.setItem('classrooms-board-collapsed', String(boardCollapsed));
    }, [boardCollapsed]);

    // Lesson Student Dialog State
    const [studentDialogOpen, setStudentDialogOpen] = useState(false);
    const [studentDialogLesson, setStudentDialogLesson] = useState<ScheduleLesson | null>(null);

    // Delete Confirm Dialog State
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    // Close context menu on global click
    useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    // Data Load
    useEffect(() => {
        const loadData = async () => {
            const weekStart = useLessonStore.getState().weekStart;
            const range = getWeekRange(weekStart);
            logger.debug('ClassroomsPage', 'weekStart:', weekStart, 'range:', range);
            const schedulesResult = await api.listScheduleLessons(range.startDate, range.endDate);
            if (schedulesResult.success) {
                useLessonStore.getState().setLessons(schedulesResult.data);
            } else {
                toast.error('스케줄 로드 실패: ' + schedulesResult.error.message);
            }

            const classroomStore = useClassroomStore.getState();
            if (Object.keys(classroomStore.classrooms).length === 0) {
                const roomsResult = await api.listClassrooms();
                if (roomsResult.success) {
                    classroomStore.setClassrooms(roomsResult.data);
                    // Do not auto-select - start with no classroom selected
                } else {
                    toast.error('강의실 로드 실패: ' + roomsResult.error.message);
                }
            }
        };
        loadData();

        // Subscribe to data changes
        const unsubscribe = onDataChange((detail) => {
            if (['lessons', 'classrooms', 'general'].includes(detail.scope)) {
                loadData();
            }
        });

        return () => {
            unsubscribe && unsubscribe();
        };
    }, []);

    // Handlers
    const handleClassroomSelect = (id: number | null) => {
        if (id !== null) {
            setViewMode('single');
        } else {
            setViewMode('multi');
        }
    };

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setSearchValue(val);
        multiViewRef.current?.setSearchQuery(val);
    };

    const handleRenameStart = (id: number) => {
        const room = classrooms[id];
        if (room) {
            setRenamingId(id);
            setRenameName(room.name || `강의실 ${id}`);
            setRenameDialogOpen(true);
        }
    };

    const handleRenameSave = async () => {
        if (renamingId !== null && renameName.trim()) {
            const result = await api.renameClassroom(renamingId, renameName.trim());
            if (result.success) {
                updateClassroom(renamingId, { name: renameName.trim() });
                setRenameDialogOpen(false);
                setRenamingId(null);
            } else {
                toast.error('이름 변경 실패: ' + result.error.message);
            }
        }
    };

    const handleDeleteClassroom = async () => {
        if (!selectedId) return;
        setPendingDeleteId(selectedId);
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = async () => {
        if (!pendingDeleteId) return;
        const result = await api.deleteClassroom(pendingDeleteId);
        if (result.success) {
            removeClassroom(pendingDeleteId);
        } else {
            toast.error('삭제 실패: ' + result.error.message);
        }
        setPendingDeleteId(null);
    };

    // Handle student management from context menu
    const handleStudentManage = (lesson: ScheduleLesson) => {
        setStudentDialogLesson(lesson);
        setStudentDialogOpen(true);
    };

    const selectedRoom = selectedId ? classrooms[selectedId] : null;
    const selectedName = selectedRoom ? (selectedRoom.name || `강의실 ${selectedRoom.id}`) : '선택된 강의실 없음';

    // Classroom list for collapsed view
    const classroomList = Object.values(classrooms);

    return (
        <div id="page-classrooms" className="flex flex-col min-h-full overflow-y-auto bg-gray-50">
            {/* Collapsible Board Panel */}
            <section
                className={cn(
                    "border-b bg-white transition-all duration-300 ease-in-out shrink-0",
                    boardCollapsed ? "h-[64px]" : "h-[500px]"
                )}
            >
                {/* Panel Header */}
                <div className="flex justify-between items-center px-4 py-3 border-b bg-gradient-to-r from-gray-50 to-white h-[64px]">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setBoardCollapsed(!boardCollapsed)}
                            className="gap-2"
                        >
                            {boardCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                            <span className="font-semibold">강의실 도면</span>
                        </Button>


                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant={editMode ? "default" : "outline"}
                            size="sm"
                            onClick={toggleEditMode}
                        >
                            {editMode ? '편집 중' : '편집 모드'}
                        </Button>
                        {!boardCollapsed && (
                            <>
                                <span className="text-xs text-muted-foreground truncate max-w-[100px]">{selectedName}</span>
                                <span
                                    className="w-3 h-3 rounded-full border"
                                    style={{ background: selectedRoom?.color || 'transparent' }}
                                />
                            </>
                        )}
                    </div>
                </div>

                {/* Board Content - Hidden when collapsed */}
                {!boardCollapsed && (
                    <div className="relative h-[calc(500px-64px)] bg-white overflow-hidden">
                        <ClassroomBoard
                            onClassroomSelect={(id) => {
                                handleClassroomSelect(id);
                            }}
                            onContextMenu={(id, x, y) => {
                                setContextMenu({ x, y, id });
                            }}
                            onRename={handleRenameStart}
                        />
                        <div className="absolute bottom-2 left-2 text-xs text-muted-foreground pointer-events-none">
                            드래그해서 강의실을 생성하세요
                        </div>
                    </div>
                )}
            </section>

            {/* Timetable Panel - Now with centered content */}
            <section className="flex flex-col bg-white">
                <div className="flex justify-between items-center px-4 py-3 border-b bg-gradient-to-r from-gray-50 to-white shrink-0">
                    <div className="font-semibold text-sm">요일별 타임테이블</div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 bg-blue-100 border border-blue-500 rounded-sm"></span>
                        <span>수업 시간</span>
                    </div>
                </div>

                <div className="flex justify-between items-center px-4 py-2 border-b bg-white shrink-0">
                    <Tabs
                        value={viewMode}
                        onValueChange={(val) => {
                            const mode = val as 'multi' | 'single';
                            setViewMode(mode);
                            // Clear classroom selection when switching to multi view
                            if (mode === 'multi') {
                                selectClassroom(null);
                            }
                        }}
                        layoutId="classrooms-view-mode"
                    >
                        <TabsList>
                            <TabsTrigger value="multi">강의실별</TabsTrigger>
                            <TabsTrigger value="single">강의실 상세</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                                checked={includeWeekend}
                                onCheckedChange={(checked) => setIncludeWeekend(checked === true)}
                            />
                            <span>주말 포함</span>
                        </label>
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="강의실 검색"
                                className="w-40 pl-8"
                                value={searchValue}
                                onChange={handleSearch}
                            />
                        </div>
                    </div>
                </div>

                {/* Centered Timetable Container */}
                <div className="bg-gray-50 flex items-center justify-center">
                    <div className="w-full max-w-[1400px] mx-auto bg-white border-x">
                        {viewMode === 'multi' ? (
                            <div>
                                <MultiView
                                    ref={multiViewRef}
                                    onClassroomClick={(id) => {
                                        // Toggle: deselect if already selected
                                        if (selectedId === id) {
                                            selectClassroom(null);
                                        } else {
                                            selectClassroom(id);
                                            handleClassroomSelect(id);
                                        }
                                    }}
                                    onLessonClick={(lesson) => {
                                        lessonDialogRef.current?.open(lesson, null, null);
                                    }}
                                />
                            </div>
                        ) : (
                            <div>
                                <TimetableGrid
                                    onLessonClick={(lesson) => {
                                        lessonDialogRef.current?.open(lesson, null, null);
                                    }}
                                    onSelectionComplete={(sel) => {
                                        lessonDialogRef.current?.open(null, sel, selectedId);
                                    }}
                                    onStudentManage={handleStudentManage}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <LessonDialog
                ref={lessonDialogRef}
                onSave={() => emitDataChange('lessons')}
                onDelete={() => emitDataChange('lessons')}
            />

            {/* Lesson Student Dialog */}
            <LessonStudentDialog
                open={studentDialogOpen}
                onOpenChange={setStudentDialogOpen}
                lesson={studentDialogLesson}
                onSuccess={() => emitDataChange('lessons')}
            />

            {/* Rename Dialog */}
            {renameDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-white p-4 rounded shadow-lg w-80">
                        <h3 className="font-semibold mb-3">강의실 이름 변경</h3>
                        <input
                            ref={renameInputRef}
                            className="w-full border p-2 rounded mb-4"
                            value={renameName}
                            onChange={(e) => setRenameName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleRenameSave()}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>취소</Button>
                            <Button onClick={handleRenameSave}>저장</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Context Menu - Using same style as TimetableGrid */}
            <ContextMenu
                open={!!contextMenu}
                x={contextMenu?.x ?? 0}
                y={contextMenu?.y ?? 0}
                onClose={() => setContextMenu(null)}
            >
                <ContextMenuItem
                    icon={<Edit className="w-4 h-4" />}
                    label="이름 변경"
                    onClick={() => {
                        if (contextMenu) handleRenameStart(contextMenu.id);
                        setContextMenu(null);
                    }}
                />
                <ContextMenuItem
                    icon={<Trash2 className="w-4 h-4" />}
                    label="삭제"
                    variant="danger"
                    onClick={() => {
                        if (contextMenu) {
                            setPendingDeleteId(contextMenu.id);
                            setDeleteConfirmOpen(true);
                        }
                        setContextMenu(null);
                    }}
                />
            </ContextMenu>

            {/* Delete Confirm Dialog */}
            <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title="강의실 삭제"
                description="이 강의실을 삭제하시겠습니까? 관련된 수업 스케줄이 함께 삭제될 수 있습니다."
                confirmLabel="삭제"
                variant="destructive"
                onConfirm={confirmDelete}
            />
        </div>
    );
}
