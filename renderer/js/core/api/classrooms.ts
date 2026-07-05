// Classroom APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { Classroom, Result } from './shared/types';
import { ok, err } from './shared/result';

export async function listClassrooms(): Promise<Result<Classroom[]>> {
    const { data, error } = await supabase
        .from('classrooms')
        .select('*')
        .order('id');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((classroom) => ({
        id: Number(classroom.id),
        x: classroom.x,
        y: classroom.y,
        width: classroom.width,
        height: classroom.height,
        color: classroom.color,
        name: classroom.name,
    })));
}

export async function createClassroom(data: Partial<Classroom>): Promise<Result<Classroom>> {
    const { data: created, error } = await supabase
        .from('classrooms')
        .insert({
            x: data.x ?? 0,
            y: data.y ?? 0,
            width: data.width ?? 100,
            height: data.height ?? 80,
            color: data.color ?? '#4CAF50',
            name: data.name ?? '새 강의실',
        })
        .select()
        .single();

    if (error) return err(new Error(error.message));

    return ok({
        id: Number(created.id),
        x: created.x,
        y: created.y,
        width: created.width,
        height: created.height,
        color: created.color,
        name: created.name,
    });
}

export async function updateClassroomPosition(id: number, x: number, y: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('classrooms')
        .update({ x, y })
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function updateClassroomRect(
    id: number,
    x: number,
    y: number,
    width: number,
    height: number
): Promise<Result<void>> {
    const { error } = await supabase
        .from('classrooms')
        .update({ x, y, width, height })
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function renameClassroom(id: number, name: string): Promise<Result<void>> {
    const { error } = await supabase
        .from('classrooms')
        .update({ name })
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function deleteClassroom(id: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('classrooms')
        .delete()
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function resetClassrooms(): Promise<Result<void>> {
    const { error } = await supabase
        .from('classrooms')
        .delete()
        .neq('id', 0); // Delete all

    if (error) return err(new Error(error.message));
    return ok(undefined);
}
