import Dexie, { type Table } from 'dexie';
import type { AppData } from './types';
import { areRollNumbersEqual, normalizeAcademicSession } from './normalization';

type Snapshot = { id: string; data: AppData; updatedAt: string; archived?: boolean };
class MarksheetDB extends Dexie {
  snapshots!: Table<Snapshot, string>;
  constructor() {
    super('marksheet-studio-v2');
    this.version(1).stores({ snapshots: '&id, updatedAt' });
    this.version(2).stores({ snapshots: '&id, updatedAt' });
    this.version(3).stores({ snapshots: '&id, updatedAt' });
  }
}
export const db = new MarksheetDB();
export const SNAPSHOT_ID = 'current-class';
export const workspaceId = (data: AppData) => `workspace:${encodeURIComponent(normalizeAcademicSession(data.academicSession))}:${encodeURIComponent(data.classInfo.className)}:${encodeURIComponent(data.classInfo.section || '')}`;
async function findWorkspaceSnapshot(id: string): Promise<Snapshot | undefined> {
  const direct = await db.snapshots.get(id);
  if (direct) return direct;
  const candidates = await db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
  return candidates.filter(item => workspaceId(item.data) === id).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
export async function loadData(): Promise<AppData | undefined> {
  return (await db.snapshots.get(SNAPSHOT_ID))?.data;
}
export async function saveData(data: AppData): Promise<void> {
  if (!String(data.classInfo?.className ?? '').trim()) throw new Error('A class name is required before saving or creating a workspace.');
  if (!String(data.academicSession ?? '').trim()) throw new Error('An academic session is required before saving or creating a workspace.');
  const updatedAt = new Date().toISOString();
  await db.transaction('rw', db.snapshots, async () => {
    const id = workspaceId(data);
    const existing = await findWorkspaceSnapshot(id);
    if (existing?.archived) throw new Error('This workspace is archived. Restore it before making changes.');
    await db.snapshots.put({ id, data, updatedAt, archived: false });
    await db.snapshots.put({ id: SNAPSHOT_ID, data, updatedAt });
  });
}

/** Persist a single-student class transfer across two same-session workspaces atomically. */
export async function moveStudentBetweenWorkspaces(sourceData: AppData, destinationData: AppData, movedStudentId: string, expectedDestinationUpdatedAt: string | null): Promise<boolean> {
  const sourceId = workspaceId(sourceData);
  const destinationId = workspaceId(destinationData);
  if (sourceId === destinationId) return false;
  const updatedAt = new Date().toISOString();
  return db.transaction('rw', db.snapshots, async () => {
    const all = await db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
    const source = all.find(item => item.id === sourceId) || all.filter(item => workspaceId(item.data) === sourceId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const existingDestination = all.find(item => item.id === destinationId) || all.filter(item => workspaceId(item.data) === destinationId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!source) return false;
    if ((expectedDestinationUpdatedAt === null && existingDestination) || (expectedDestinationUpdatedAt !== null && existingDestination?.updatedAt !== expectedDestinationUpdatedAt)) return false;
    if (existingDestination?.archived) return false;
    const existingData = existingDestination?.data;
    const movedStudent = destinationData.students.find(student => student.studentId === movedStudentId);
    const duplicateStudent = existingData?.students?.some(student => student.studentId === movedStudentId);
    const duplicateRoll = movedStudent && existingData?.students?.some(student => areRollNumbersEqual(student.roll, movedStudent.roll));
    if (duplicateStudent || duplicateRoll) return false;
    await db.snapshots.put({ id: sourceId, data: sourceData, updatedAt });
    await db.snapshots.put({ id: destinationId, data: destinationData, updatedAt });
    if (source.id !== sourceId) await db.snapshots.delete(source.id);
    if (existingDestination && existingDestination.id !== destinationId) await db.snapshots.delete(existingDestination.id);
    await db.snapshots.put({ id: SNAPSHOT_ID, data: sourceData, updatedAt });
    return true;
  });
}

export async function saveWorkspace(data: AppData): Promise<void> {
  if (!String(data.classInfo?.className ?? '').trim()) throw new Error('A class name is required before saving or creating a workspace.');
  if (!String(data.academicSession ?? '').trim()) throw new Error('An academic session is required before saving or creating a workspace.');
  const id = workspaceId(data);
  const existing = await findWorkspaceSnapshot(id);
  if (existing?.archived) throw new Error('This workspace is archived. Restore it before making changes.');
  await db.snapshots.put({ id, data, updatedAt: new Date().toISOString(), archived: false });
}
export async function loadWorkspace(id: string): Promise<AppData | undefined> {
  return (await findWorkspaceSnapshot(id))?.data;
}
export async function loadWorkspaceSnapshot(id: string): Promise<{ data: AppData; updatedAt: string; archived: boolean } | undefined> {
  const snapshot = await findWorkspaceSnapshot(id);
  return snapshot ? { data: snapshot.data, updatedAt: snapshot.updatedAt, archived: Boolean(snapshot.archived) } : undefined;
}

export async function listWorkspaces(): Promise<Array<{ id: string; data: AppData; updatedAt: string; archived: boolean }>> {
  const items = await db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
  const byCanonicalId = new Map<string, typeof items[number]>();
  for (const item of items) {
    const canonicalId = workspaceId(item.data);
    const current = byCanonicalId.get(canonicalId);
    if (!current || item.updatedAt > current.updatedAt) byCanonicalId.set(canonicalId, item);
  }
  return [...byCanonicalId.entries()].map(([id, item]) => ({ id, data: item.data, updatedAt: item.updatedAt, archived: Boolean(item.archived) }));
}

/** Archive a non-active workspace without deleting any of its data. */
export async function archiveWorkspace(id: string, activeWorkspaceId: string): Promise<boolean> {
  if (!id || id === activeWorkspaceId) return false;
  return db.transaction('rw', db.snapshots, async () => {
    const matches = await db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
    const targets = matches.filter(item => workspaceId(item.data) === id);
    if (!targets.length) return false;
    for (const item of targets) await db.snapshots.put({ ...item, archived: true });
    return true;
  });
}

/** Restore a previously archived workspace. */
export async function restoreWorkspace(id: string): Promise<boolean> {
  if (!id) return false;
  return db.transaction('rw', db.snapshots, async () => {
    const matches = await db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
    const targets = matches.filter(item => workspaceId(item.data) === id);
    if (!targets.length) return false;
    for (const item of targets) await db.snapshots.put({ ...item, archived: false });
    return true;
  });
}


/** Delete only the selected saved workspace; never delete the active snapshot implicitly. */
export async function deleteWorkspace(id: string, activeWorkspaceId: string): Promise<boolean> {
  if (!id || id === activeWorkspaceId) return false;
  return db.transaction('rw', db.snapshots, async () => {
    const direct = await db.snapshots.get(id);
    if (direct) await db.snapshots.delete(id);
    const legacy = await db.snapshots.filter(item => item.id.startsWith('workspace:') && workspaceId(item.data) === id).toArray();
    for (const item of legacy) await db.snapshots.delete(item.id);
    return Boolean(direct || legacy.length);
  });
}

/** Rename the active class workspace without overwriting an existing workspace. */
export async function renameClassWorkspace(previousData: AppData, nextData: AppData): Promise<'renamed' | 'same' | 'exists' | 'missing'> {
  if (!String(nextData.classInfo?.className ?? '').trim() || !String(nextData.academicSession ?? '').trim()) throw new Error('A class name and academic session are required before renaming a workspace.');
  const previousId = workspaceId(previousData);
  const nextId = workspaceId(nextData);
  if (previousId === nextId) return 'same';
  const updatedAt = new Date().toISOString();
  return db.transaction('rw', db.snapshots, async () => {
    const all = await db.snapshots.filter(item => item.id.startsWith('workspace:')).toArray();
    const source = all.find(item => item.id === previousId) || all.filter(item => workspaceId(item.data) === previousId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!source) return 'missing' as const;
    const destination = all.find(item => item.id === nextId) || all.filter(item => workspaceId(item.data) === nextId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (destination) return 'exists' as const;
    await db.snapshots.put({ id: nextId, data: nextData, updatedAt });
    await db.snapshots.put({ id: SNAPSHOT_ID, data: nextData, updatedAt });
    await db.snapshots.delete(source.id);
    return 'renamed' as const;
  });
}
