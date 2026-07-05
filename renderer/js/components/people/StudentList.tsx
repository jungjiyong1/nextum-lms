import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Search } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { onDataChange, emitDataChange } from '../../core/events';
import { cn } from '../../lib/utils';
import { useStudents } from './students/useStudents';
import { StudentListPanel } from './students/StudentListPanel';
import { StudentDetailPanel } from './students/StudentDetailPanel';
import { StudentFormDialog } from './students/StudentFormDialog';
import { AssignmentDialog } from './students/AssignmentDialog';
import type { Student } from '../../core/types';

type SortOption = 'name' | 'age' | 'grade' | 'enrollment';

export function StudentList() {
    // --- State & Hook ---
    const {
        students,
        loading,
        selectedStudent,
        setSelectedStudent,
        extras,
        loadStudents,
        loadStudentExtras,
        deleteStudent,
        unassignEnrollment
    } = useStudents();

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [schoolTypeFilter, setSchoolTypeFilter] = useState<string>('');
    const [gradeFilter, setGradeFilter] = useState<string>('');
    const [sortBy, setSortBy] = useState<SortOption>('name');
    const [showOverdueOnly, setShowOverdueOnly] = useState(false);

    const debouncedSearch = useDebounce(searchQuery, 300);

    // Dialogs
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);

    // --- Loading Logic ---
    useEffect(() => {
        loadStudents(debouncedSearch, showOverdueOnly, statusFilter);
    }, [debouncedSearch, statusFilter, showOverdueOnly, loadStudents]);

    // Data Change Listener - 학생 목록만 갱신 (extras는 학생 선택 시에만 로드)
    useEffect(() => {
        const unsubscribe = onDataChange(({ scope }) => {
            if (['students', 'enrollments'].includes(scope)) {
                loadStudents(debouncedSearch, showOverdueOnly, statusFilter);
            }
        });
        return unsubscribe;
    }, [loadStudents, debouncedSearch, showOverdueOnly, statusFilter]);

    // Selection Handling
    const handleSelectStudent = (student: Student) => {
        if (selectedStudent?.id === student.id) return;
        setSelectedStudent(student);
        loadStudentExtras(student.id);
    };

    // --- Derived State (Client-side Filtering) ---
    const filteredStudents = useMemo(() => {
        let result = [...students];

        if (schoolTypeFilter && schoolTypeFilter !== 'all') {
            result = result.filter(s => s.school_type === schoolTypeFilter);
        }
        if (gradeFilter && gradeFilter !== 'all') {
            result = result.filter(s => s.grade === parseInt(gradeFilter));
        }

        result.sort((a, b) => {
            switch (sortBy) {
                case 'age':
                    if (!a.date_of_birth) return 1;
                    if (!b.date_of_birth) return -1;
                    return a.date_of_birth.localeCompare(b.date_of_birth);
                case 'grade':
                    if (a.grade === null) return 1;
                    if (b.grade === null) return -1;
                    if (a.school_type !== b.school_type) {
                        const order = ['elementary', 'middle', 'high'];
                        return (order.indexOf(a.school_type || '') - order.indexOf(b.school_type || ''));
                    }
                    return (a.grade || 0) - (b.grade || 0);
                case 'enrollment':
                    if (!a.enrollment_date) return 1;
                    if (!b.enrollment_date) return -1;
                    return b.enrollment_date.localeCompare(a.enrollment_date);
                case 'name':
                default:
                    const nameA = a.name || '';
                    const nameB = b.name || '';
                    return nameA.localeCompare(nameB, 'ko');
            }
        });

        return result;
    }, [students, schoolTypeFilter, gradeFilter, sortBy]);

    // Helpers
    const getGradeOptions = (type: string) => {
        if (type === 'elementary') return [1, 2, 3, 4, 5, 6];
        if (type === 'middle' || type === 'high') return [1, 2, 3];
        return [1, 2, 3, 4, 5, 6];
    };

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b p-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold">학생 관리</h2>
                    <Button onClick={() => setIsAddDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        학생 추가
                    </Button>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="학생 검색..."
                            className="w-64 pl-8"
                            value={searchQuery}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/20 p-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="전체 상태" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 상태</SelectItem>
                        <SelectItem value="active">재원</SelectItem>
                        <SelectItem value="on_leave">휴원</SelectItem>
                        <SelectItem value="dropped">퇴원</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={schoolTypeFilter} onValueChange={setSchoolTypeFilter}>
                    <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="전체 학교" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 학교</SelectItem>
                        <SelectItem value="elementary">초등학교</SelectItem>
                        <SelectItem value="middle">중학교</SelectItem>
                        <SelectItem value="high">고등학교</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                    <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="전체 학년" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 학년</SelectItem>
                        {getGradeOptions(schoolTypeFilter === 'all' ? '' : schoolTypeFilter).map(g => (
                            <SelectItem key={g} value={String(g)}>{g}학년</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                    <SelectTrigger className="w-[120px]">
                        <SelectValue placeholder="정렬" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="name">이름순</SelectItem>
                        <SelectItem value="age">나이순</SelectItem>
                        <SelectItem value="grade">학년순</SelectItem>
                        <SelectItem value="enrollment">등록순</SelectItem>
                    </SelectContent>
                </Select>

                <div className="ml-2 flex items-center space-x-2">
                    <Checkbox
                        id="overdue"
                        checked={showOverdueOnly}
                        onCheckedChange={(c: boolean | "indeterminate") => {
                            setShowOverdueOnly(!!c);
                            if (c) setStatusFilter('');
                        }}
                    />
                    <label
                        htmlFor="overdue"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                        미납자만
                    </label>
                </div>
            </div>

            {/* Split Content */}
            <div className="flex flex-1 overflow-hidden">
                <StudentListPanel
                    students={filteredStudents}
                    selectedId={selectedStudent?.id || null}
                    onSelect={handleSelectStudent}
                    loading={loading}
                />

                <StudentDetailPanel
                    student={selectedStudent}
                    enrollments={extras.enrollments}
                    payments={extras.payments}
                    irregularLessons={extras.irregularLessons || []}
                    loadingExtras={extras.loading}
                    onEdit={() => setIsEditDialogOpen(true)}
                    onDelete={() => selectedStudent && deleteStudent(selectedStudent.id)}
                    onAssign={() => setIsAssignDialogOpen(true)}
                    onUnassign={unassignEnrollment}
                />
            </div>

            {/* Dialogs */}
            <StudentFormDialog
                open={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                onSuccess={() => {
                    loadStudents(debouncedSearch, showOverdueOnly, statusFilter);
                    setSelectedStudent(null);
                }}
            />
            {selectedStudent && (
                <>
                    <StudentFormDialog
                        open={isEditDialogOpen}
                        onOpenChange={setIsEditDialogOpen}
                        student={selectedStudent}
                        onSuccess={() => {
                            loadStudents(debouncedSearch, showOverdueOnly, statusFilter);
                        }}
                    />
                    <AssignmentDialog
                        open={isAssignDialogOpen}
                        onOpenChange={setIsAssignDialogOpen}
                        student={selectedStudent}
                        onSuccess={() => {
                            loadStudentExtras(selectedStudent.id);
                            emitDataChange('enrollments');
                        }}
                    />
                </>
            )}
        </div>
    );
}
