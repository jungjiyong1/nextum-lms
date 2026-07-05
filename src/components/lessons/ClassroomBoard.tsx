import React, { useState, useRef, useCallback, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { useClassroomStore } from '../../stores/classroomStore';
import * as api from '../../core/api';
import { clamp, snapToGrid, rectsOverlap } from '../../core/utils/dom';
import { safeSetPointerCapture } from '../../core/utils/pointer';
import { GRID_SIZE_PX, MIN_ROOM_SIZE_PX } from '../../core/constants';
import type { Classroom } from '../../core/types';

// Muted color palette for classrooms (hex values extracted from LESSON_COLORS)
const CLASSROOM_COLORS = [
    '#c5c9a4', // Olive green
    '#d4d4c8', // Warm gray
    '#bdc3a7', // Sage green
    '#d6cfc2', // Beige/Sand
    '#c9c5b8', // Stone
    '#b8c4a8', // Muted green
    '#d0c9b8', // Khaki
    '#c2c8b5', // Moss
    '#ccc9be', // Taupe
    '#b5c2a4', // Fern
    '#d4c4c4', // Dusty rose
    '#b8c4c9', // Slate blue
    '#d4c4b4', // Terracotta
    '#c9c4d0', // Mauve
    '#b4c9c4', // Seafoam
];

interface ClassroomBoardProps {
    onClassroomSelect: (id: number | null) => void;
    onContextMenu: (id: number, x: number, y: number) => void;
    onRename?: (id: number) => void;
}

interface DrawState {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    ghost: { x: number; y: number; width: number; height: number };
}

interface MoveState {
    id: number;
    offsetX: number;
    offsetY: number;
    bounds: DOMRect;
    lastValid: { x: number; y: number };
}

interface ResizeState {
    id: number;
    handle: string;
    bounds: DOMRect;
    origin: { x: number; y: number; width: number; height: number };
    startX: number;
    startY: number;
    currentRect: { x: number; y: number; width: number; height: number };
}

export function ClassroomBoard(props: ClassroomBoardProps) {
    const classroomsMap = useClassroomStore((state) => state.classrooms);
    const classrooms = useMemo(() => Object.values(classroomsMap), [classroomsMap]);
    const selectedId = useClassroomStore((state) => state.selectedId);
    const editMode = useClassroomStore((state) => state.editMode);

    const svgRef = useRef<SVGSVGElement>(null);

    // Interaction States
    const [drawState, setDrawState] = useState<DrawState | null>(null);
    const [moveState, setMoveState] = useState<MoveState | null>(null);
    const [resizeState, setResizeState] = useState<ResizeState | null>(null);
    const [editingClassroomId, setEditingClassroomId] = useState<number | null>(null); // For edit mode visual feedback

    // Helpers
    const getSvgPoint = (e: React.PointerEvent) => {
        if (!svgRef.current) return null;
        const bounds = svgRef.current.getBoundingClientRect();
        return {
            x: clamp(e.clientX - bounds.left, 0, bounds.width),
            y: clamp(e.clientY - bounds.top, 0, bounds.height),
            bounds
        };
    };

    const isOverlapping = (candidate: { x: number; y: number; width: number; height: number }, ignoreId: number | null) => {
        for (const room of classrooms) {
            if (room.id === ignoreId) continue;
            if (rectsOverlap(candidate, room)) {
                return true;
            }
        }
        return false;
    };

    const getDisplayName = (c: Classroom) => {
        return (c.name && c.name.trim()) ? c.name.trim() : `강의실 ${c.id}`;
    };

    // Generate next sequential classroom name based on existing classrooms
    const getNextClassroomName = (): string => {
        const existingNumbers: number[] = [];
        for (const c of classrooms) {
            const name = c.name?.trim() || '';
            const match = name.match(/^강의실\s*(\d+)$/);
            if (match) {
                existingNumbers.push(parseInt(match[1], 10));
            }
        }
        // Find the next available number
        let nextNum = 1;
        while (existingNumbers.includes(nextNum)) {
            nextNum++;
        }
        return `강의실 ${nextNum}`;
    };

    // Get a random muted color from the palette
    const getRandomClassroomColor = (): string => {
        return CLASSROOM_COLORS[Math.floor(Math.random() * CLASSROOM_COLORS.length)];
    };

    // Handlers
    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0 || !editMode) return;
        if ((e.target as Element).closest('.classroom-group')) return;

        const point = getSvgPoint(e);
        if (!point) return;

        const startX = snapToGrid(point.x, GRID_SIZE_PX);
        const startY = snapToGrid(point.y, GRID_SIZE_PX);

        setDrawState({
            startX,
            startY,
            currentX: startX,
            currentY: startY,
            ghost: { x: startX, y: startY, width: 0, height: 0 }
        });

        safeSetPointerCapture(e.currentTarget as HTMLElement | SVGElement, e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (drawState) {
            const point = getSvgPoint(e);
            if (!point) return;

            const snappedX = snapToGrid(point.x, GRID_SIZE_PX);
            const snappedY = snapToGrid(point.y, GRID_SIZE_PX);

            const minX = Math.min(drawState.startX, snappedX);
            const minY = Math.min(drawState.startY, snappedY);
            const width = Math.abs(snappedX - drawState.startX);
            const height = Math.abs(snappedY - drawState.startY);

            setDrawState({
                ...drawState,
                currentX: snappedX,
                currentY: snappedY,
                ghost: { x: minX, y: minY, width, height }
            });
        } else if (moveState) {
            const point = getSvgPoint(e);
            if (!point) return;

            const { bounds, offsetX, offsetY, id } = moveState;
            const classroom = classrooms.find(c => c.id === id);
            if (!classroom) return;

            const widthPx = classroom.width * bounds.width;
            const heightPx = classroom.height * bounds.height;

            let nextX = point.x - offsetX;
            let nextY = point.y - offsetY;

            nextX = snapToGrid(nextX, GRID_SIZE_PX);
            nextY = snapToGrid(nextY, GRID_SIZE_PX);

            nextX = clamp(nextX, 0, bounds.width - widthPx);
            nextY = clamp(nextY, 0, bounds.height - heightPx);

            const candidate = {
                x: nextX / bounds.width,
                y: nextY / bounds.height,
                width: classroom.width,
                height: classroom.height
            };

            if (!isOverlapping(candidate, id)) {
                setMoveState({
                    ...moveState,
                    lastValid: { x: candidate.x, y: candidate.y }
                });

                // Optimistic update via store
                useClassroomStore.getState().updateClassroom(id, { x: candidate.x, y: candidate.y });
            }
        } else if (resizeState) {
            const { id, startX, startY, origin, handle, bounds } = resizeState;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            const rectPx = computeResizeRect(handle, origin, dx, dy, bounds);

            let snappedX = snapToGrid(rectPx.x, GRID_SIZE_PX);
            let snappedY = snapToGrid(rectPx.y, GRID_SIZE_PX);
            let snappedW = snapToGrid(rectPx.width, GRID_SIZE_PX);
            let snappedH = snapToGrid(rectPx.height, GRID_SIZE_PX);

            snappedW = Math.max(MIN_ROOM_SIZE_PX, snappedW);
            snappedH = Math.max(MIN_ROOM_SIZE_PX, snappedH);

            snappedX = clamp(snappedX, 0, bounds.width - snappedW);
            snappedY = clamp(snappedY, 0, bounds.height - snappedH);
            snappedW = clamp(snappedW, MIN_ROOM_SIZE_PX, bounds.width - snappedX);
            snappedH = clamp(snappedH, MIN_ROOM_SIZE_PX, bounds.height - snappedY);

            const candidate = {
                x: snappedX / bounds.width,
                y: snappedY / bounds.height,
                width: snappedW / bounds.width,
                height: snappedH / bounds.height
            };

            if (!isOverlapping(candidate, id)) {
                setResizeState({
                    ...resizeState,
                    currentRect: { x: snappedX, y: snappedY, width: snappedW, height: snappedH }
                });
                useClassroomStore.getState().updateClassroom(id, candidate);
            }
        }
    };

    const handlePointerUp = async (e: React.PointerEvent) => {
        if (drawState) {
            const { ghost } = drawState;
            const bounds = svgRef.current?.getBoundingClientRect();
            if (bounds && ghost.width >= 12 && ghost.height >= 12) {
                const payload = {
                    x: ghost.x / bounds.width,
                    y: ghost.y / bounds.height,
                    width: ghost.width / bounds.width,
                    height: ghost.height / bounds.height,
                    name: getNextClassroomName(),
                    color: getRandomClassroomColor(),
                };

                if (isOverlapping(payload, null)) {
                    alert('다른 강의실과 겹쳐서 생성할 수 없습니다.');
                } else {
                    const result = await api.createClassroom(payload);
                    if (result.success) {
                        const store = useClassroomStore.getState();
                        store.addClassroom(result.data);
                        store.selectClassroom(result.data.id);
                        props.onClassroomSelect(result.data.id);
                    } else {
                        console.error(result.error);
                    }
                }
            }
            setDrawState(null);
        } else if (moveState) {
            if (moveState.lastValid) {
                const result = await api.updateClassroomPosition(moveState.id, moveState.lastValid.x, moveState.lastValid.y);
                if (!result.success) {
                    console.error('Failed to update position:', result.error);
                }
            }
            setMoveState(null);
        } else if (resizeState) {
            const c = useClassroomStore.getState().classrooms[resizeState.id];
            if (c) {
                const result = await api.updateClassroomRect(c.id, c.x, c.y, c.width, c.height);
                if (!result.success) {
                    console.error('Failed to update rect:', result.error);
                }
            }
            setResizeState(null);
        }
    };

    const handleClassroomPointerDown = (e: React.PointerEvent, id: number) => {
        if (e.button !== 0) return;
        e.stopPropagation();

        if (!editMode) {
            // Normal mode: toggle selection for timetable view
            const store = useClassroomStore.getState();
            if (selectedId === id) {
                store.selectClassroom(null);
                props.onClassroomSelect(null);
            } else {
                store.selectClassroom(id);
                props.onClassroomSelect(id);
            }
            return;
        }

        // Edit mode: set local editing state (for handles) and initiate move
        setEditingClassroomId(id);

        const point = getSvgPoint(e);
        const classroom = classrooms.find(c => c.id === id);
        if (!point || !classroom) return;

        const bounds = point.bounds;
        const offsetX = point.x - classroom.x * bounds.width;
        const offsetY = point.y - classroom.y * bounds.height;

        setMoveState({
            id,
            offsetX,
            offsetY,
            bounds,
            lastValid: { x: classroom.x, y: classroom.y }
        });

        if (svgRef.current) safeSetPointerCapture(svgRef.current, e.pointerId);
    };

    const handleResizeStart = (e: React.PointerEvent, id: number, handle: string) => {
        if (e.button !== 0 || !editMode) return;
        e.stopPropagation();
        setEditingClassroomId(id); // Set local editing state for visual feedback

        const classroom = classrooms.find(c => c.id === id);
        if (!classroom || !svgRef.current) return;

        const bounds = svgRef.current.getBoundingClientRect();
        const origin = {
            x: classroom.x * bounds.width,
            y: classroom.y * bounds.height,
            width: classroom.width * bounds.width,
            height: classroom.height * bounds.height
        };

        setResizeState({
            id,
            handle,
            bounds,
            origin,
            startX: e.clientX,
            startY: e.clientY,
            currentRect: { ...origin }
        });

        if (svgRef.current) safeSetPointerCapture(svgRef.current, e.pointerId);
    };

    const computeResizeRect = (handle: string, origin: any, dx: number, dy: number, bounds: DOMRect) => {
        let { x, y, width, height } = origin;
        if (handle === 'nw') {
            const maxX = origin.x + origin.width - MIN_ROOM_SIZE_PX;
            const maxY = origin.y + origin.height - MIN_ROOM_SIZE_PX;
            x = clamp(origin.x + dx, 0, maxX);
            y = clamp(origin.y + dy, 0, maxY);
            width = origin.x + origin.width - x;
            height = origin.y + origin.height - y;
        } else if (handle === 'ne') {
            const maxY = origin.y + origin.height - MIN_ROOM_SIZE_PX;
            y = clamp(origin.y + dy, 0, maxY);
            width = clamp(origin.width + dx, MIN_ROOM_SIZE_PX, bounds.width - origin.x);
            height = origin.y + origin.height - y;
        } else if (handle === 'sw') {
            const maxX = origin.x + origin.width - MIN_ROOM_SIZE_PX;
            x = clamp(origin.x + dx, 0, maxX);
            width = origin.x + origin.width - x;
            height = clamp(origin.height + dy, MIN_ROOM_SIZE_PX, bounds.height - origin.y);
        } else if (handle === 'se') {
            width = clamp(origin.width + dx, MIN_ROOM_SIZE_PX, bounds.width - origin.x);
            height = clamp(origin.height + dy, MIN_ROOM_SIZE_PX, bounds.height - origin.y);
        }
        return { x, y, width, height };
    };

    return (
        <div className={cn(
            "w-full h-full relative rounded-xl border border-dashed border-emerald-200",
            "bg-gradient-to-br from-white via-gray-50 to-emerald-50/30",
            "bg-[length:20px_20px]",
            "[background-image:linear-gradient(180deg,rgba(255,255,255,0.9),rgba(245,250,247,0.6)),repeating-linear-gradient(0deg,rgba(33,33,33,0.04)_0,rgba(33,33,33,0.04)_1px,transparent_1px,transparent_20px),repeating-linear-gradient(90deg,rgba(33,33,33,0.035)_0,rgba(33,33,33,0.035)_1px,transparent_1px,transparent_20px)]",
            editMode && "cursor-crosshair"
        )}>
            <svg
                ref={svgRef}
                aria-label="강의실 도면"
                className="w-full h-full block"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                {classrooms.map(c => {
                    // In edit mode: use editingClassroomId for visual feedback (handles)
                    // In normal mode: use selectedId for timetable selection (green border)
                    const isSelected = !editMode && c.id === selectedId;
                    const isEditing = editMode && c.id === editingClassroomId;
                    const isDragging = moveState?.id === c.id;

                    return (
                        <g
                            key={c.id}
                            className={cn("cursor-pointer", isDragging && "cursor-grabbing")}
                            onPointerDown={(e) => handleClassroomPointerDown(e, c.id)}
                            onContextMenu={(e) => { e.preventDefault(); if (editMode) props.onContextMenu(c.id, e.clientX, e.clientY); }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (editMode && props.onRename) {
                                    useClassroomStore.getState().selectClassroom(c.id);
                                    props.onRename(c.id);
                                }
                            }}
                        >
                            <rect
                                x={`${c.x * 100}%`}
                                y={`${c.y * 100}%`}
                                width={`${c.width * 100}%`}
                                height={`${c.height * 100}%`}
                                fill={c.color}
                                rx="8"
                                ry="8"
                                style={{
                                    fillOpacity: 0.72,
                                    stroke: (isSelected || isEditing) ? '#138a48' : 'rgba(0,0,0,0.3)',
                                    strokeWidth: (isSelected || isEditing) ? 3 : 2,
                                    filter: (isSelected || isEditing) ? 'drop-shadow(0 6px 12px rgba(31,157,87,0.18))' : 'none',
                                    transition: 'stroke 0.15s ease, stroke-width 0.15s ease, filter 0.15s ease',
                                    cursor: editMode ? 'grab' : 'pointer'
                                }}
                            />
                            <text
                                x={`${(c.x + c.width / 2) * 100}%`}
                                y={`${(c.y + c.height / 2) * 100}%`}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                pointerEvents="none"
                                style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    fill: 'rgba(20,20,20,0.85)',
                                    textShadow: '0 2px 6px rgba(255,255,255,0.75)',
                                    userSelect: 'none'
                                }}
                            >
                                {getDisplayName(c)}
                            </text>

                            {/* Resize Handles - Only show in edit mode for editing classroom */}
                            {editMode && isEditing && (
                                <>
                                    {['nw', 'ne', 'sw', 'se'].map(h => {
                                        let cx = c.x, cy = c.y;
                                        if (h.includes('e')) cx += c.width;
                                        if (h.includes('s')) cy += c.height;
                                        return (
                                            <circle
                                                key={h}
                                                cx={`${cx * 100}%`}
                                                cy={`${cy * 100}%`}
                                                r="6"
                                                style={{
                                                    fill: '#fff',
                                                    stroke: '#138a48',
                                                    strokeWidth: 2,
                                                    cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
                                                    transition: 'transform 0.15s ease'
                                                }}
                                                onPointerDown={(e) => handleResizeStart(e, c.id, h)}
                                            />
                                        );
                                    })}
                                </>
                            )}
                        </g>
                    );
                })}

                {/* Ghost for Draw */}
                {drawState && (
                    <rect
                        x={drawState.ghost.x}
                        y={drawState.ghost.y}
                        width={drawState.ghost.width}
                        height={drawState.ghost.height}
                        rx="8"
                        ry="8"
                        style={{
                            fill: 'rgba(31,157,87,0.12)',
                            stroke: 'rgba(31,157,87,0.6)',
                            strokeWidth: 2,
                            strokeDasharray: '6 4',
                            pointerEvents: 'none'
                        }}
                    />
                )}
            </svg>
        </div>
    );
}
