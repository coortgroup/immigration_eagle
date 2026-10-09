import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftSummary, QualificationAnswer } from './types';

export interface SavedDraft extends DraftSummary {
  version: 1;
  answers: Record<string, string>;
  checks: Record<string, QualificationAnswer>;
}

const KEY = 'immigration-eagle.preparation-drafts.v1';
let pending: Promise<unknown> = Promise.resolve();

function isDraft(value: unknown): value is SavedDraft {
  if (!value || typeof value !== 'object') return false;
  const item = value as SavedDraft;
  return item.version === 1 && typeof item.formId === 'string' && /^[A-Z]+-\d+[A-Z]*$/.test(item.formId)
    && typeof item.title === 'string' && Number.isInteger(item.answered) && Number.isInteger(item.total)
    && item.total > 0 && item.answered >= 0 && item.answered <= item.total
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
    && !!item.answers && typeof item.answers === 'object' && !Array.isArray(item.answers)
    && Object.values(item.answers).every(answer => typeof answer === 'string' && answer.length <= 2000)
    && !!item.checks && typeof item.checks === 'object' && !Array.isArray(item.checks)
    && Object.values(item.checks).every(answer => ['yes', 'no', 'unsure'].includes(answer));
}

async function readDrafts(): Promise<SavedDraft[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || !data.every(isDraft)) throw new Error();
    return data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    throw new Error('Saved drafts could not be read. Your existing data has not been changed.');
  }
}

export async function listDrafts(): Promise<SavedDraft[]> {
  await pending;
  return readDrafts();
}

export async function loadDraft(formId?: string): Promise<SavedDraft | null> {
  const drafts = await listDrafts();
  return (formId ? drafts.find(draft => draft.formId === formId) : drafts[0]) || null;
}

function update(transform: (drafts: SavedDraft[]) => SavedDraft[]): Promise<void> {
  const operation = pending.then(async () => {
    const drafts = transform(await readDrafts());
    await AsyncStorage.setItem(KEY, JSON.stringify(drafts));
  });
  pending = operation.catch(() => undefined);
  return operation;
}

export async function saveDraft(draft: SavedDraft): Promise<void> {
  if (!isDraft(draft)) throw new Error('This draft could not be saved. Check your answers and try again.');
  return update(drafts => [draft, ...drafts.filter(item => item.formId !== draft.formId)]);
}

export async function deleteDraft(formId: string): Promise<void> {
  return update(drafts => drafts.filter(item => item.formId !== formId));
}
