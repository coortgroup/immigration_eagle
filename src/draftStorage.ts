import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftSummary, QualificationAnswer } from './types';

export interface SavedDraft extends DraftSummary {
  version: 1;
  answers: Record<string, string>;
  checks: Record<string, QualificationAnswer>;
  completedFieldIds?: string[];
  fullAnswers?: Record<string, string | string[]>;
  completedQuestionIds?: string[];
  pdfValues?: Record<string, string | boolean>;
  pdfPage?: number;
  /** Random purchase scope, never a receipt or a client-controlled paid flag. */
  paymentCaseId?: string;
  paymentParentCaseId?: string;
  attorneyDetails?: { name: string; email: string; phone: string; note: string };
}

const KEY = 'immigration-eagle.preparation-drafts.v1';
let pending: Promise<unknown> = Promise.resolve();
type DraftOwner = { id: string | null; key: string; latestSaveResults: Map<string, Promise<boolean>>; saveRevision: number; revoked?: boolean };
const owners = new Map<string, DraftOwner>();
function validateOwnerId(ownerId: string | null): void {
  if (ownerId !== null && (typeof ownerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(ownerId))) {
    throw new Error('This account could not be opened. Please sign in again.');
  }
}
function ownerContext(id: string | null): DraftOwner {
  const key = id === null ? KEY : `${KEY}.owner.${id}`;
  let owner = owners.get(key);
  if (!owner) {
    owner = { id, key, latestSaveResults: new Map(), saveRevision: 0 };
    owners.set(key, owner);
  }
  return owner;
}
let currentOwner = ownerContext(null);
const unsavedError = () => new Error('Your draft could not be saved. Keep this screen open and try again.');

function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const operation = pending.then(action);
  pending = operation.catch(() => undefined);
  return operation;
}

const MAX_FIELDS = 10000;
const MAX_TEXT_LENGTH = 20000;
const isText = (value: unknown, max = MAX_TEXT_LENGTH): value is string => typeof value === 'string' && value.length <= max;
const isFieldId = (value: unknown): value is string => isText(value, 512) && value.length > 0
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function isAnswerMap(value: unknown, validate: (answer: unknown) => boolean): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_FIELDS && entries.every(([key, answer]) => isFieldId(key) && validate(answer));
}
function isIdList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_FIELDS && value.every(isFieldId) && new Set(value).size === value.length;
}

function isDraft(value: unknown): value is SavedDraft {
  if (!isRecord(value)) return false;
  const item = value as unknown as SavedDraft;
  return item.version === 1 && typeof item.formId === 'string' && /^[A-Z]+-\d+[A-Z]*$/.test(item.formId)
    && isText(item.title, 1000) && Number.isInteger(item.answered) && Number.isInteger(item.total)
    && item.total > 0 && item.total <= MAX_FIELDS && item.answered >= 0 && item.answered <= item.total
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
    && isAnswerMap(item.answers, answer => isText(answer, 2000))
    && isAnswerMap(item.checks, answer => typeof answer === 'string' && ['yes', 'no', 'unsure'].includes(answer))
    && (item.mode === undefined || ['self', 'ai', 'attorney'].includes(item.mode))
    && (item.stage === undefined || ['check', 'interview', 'fullPreparation', 'freePreparation', 'attorney'].includes(item.stage))
    && (item.attorneyStatus === undefined || ['awaiting_call', 'preparing_documents', 'sent'].includes(item.attorneyStatus))
    && (item.completedFieldIds === undefined || isIdList(item.completedFieldIds))
    && (item.fullAnswers === undefined || isAnswerMap(item.fullAnswers, answer => isText(answer)
      || (Array.isArray(answer) && answer.length <= 100 && answer.every(value => isText(value)))))
    && (item.completedQuestionIds === undefined || isIdList(item.completedQuestionIds))
    && (item.pdfValues === undefined || isAnswerMap(item.pdfValues, answer => isText(answer) || typeof answer === 'boolean'))
    && (item.pdfPage === undefined || (Number.isInteger(item.pdfPage) && item.pdfPage >= 1 && item.pdfPage <= 1000))
    && [item.paymentCaseId, item.paymentParentCaseId].every(id => id === undefined || (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))
    && (item.attorneyDetails === undefined || (isRecord(item.attorneyDetails)
      && Object.keys(item.attorneyDetails).length === 4
      && isText(item.attorneyDetails.name, 2000) && isText(item.attorneyDetails.email, 2000)
      && isText(item.attorneyDetails.phone, 2000) && isText(item.attorneyDetails.note)));
}

async function readDrafts(owner: DraftOwner): Promise<SavedDraft[]> {
  const raw = await AsyncStorage.getItem(owner.key);
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
  const owner = currentOwner;
  await pending;
  return readDrafts(owner);
}

export async function loadDraft(formId?: string): Promise<SavedDraft | null> {
  const owner = currentOwner;
  // The list may show the last safely stored version after a failed write, but
  // restoring it would replace newer answers still held by the active editor.
  // Wait for real save outcomes and repeat if a write starts during the read.
  while (true) {
    const revision = owner.saveRevision;
    const writes = pending;
    await writes;
    const results = await Promise.all(owner.latestSaveResults.values());
    if (writes !== pending || revision !== owner.saveRevision) continue;
    if (results.some(saved => !saved)) throw unsavedError();
    const drafts = await readDrafts(owner);
    if (writes !== pending || revision !== owner.saveRevision) continue;
    return (formId ? drafts.find(draft => draft.formId === formId) : drafts[0]) || null;
  }
}

function update(owner: DraftOwner, transform: (drafts: SavedDraft[]) => SavedDraft[]): Promise<void> {
  return enqueue(async () => {
    if (owner.revoked) throw new Error('This account data is being deleted.');
    const drafts = transform(await readDrafts(owner));
    if (owner.revoked) throw new Error('This account data is being deleted.');
    await AsyncStorage.setItem(owner.key, JSON.stringify(drafts));
  });
}

export async function saveDraft(draft: SavedDraft, ownerId?: string | null): Promise<void> {
  if (ownerId !== undefined) validateOwnerId(ownerId);
  // Retained editors keep the owner from their mounted session, including
  // messages arriving after storage has switched to the next account.
  const owner = ownerId === undefined ? currentOwner : ownerContext(ownerId);
  if (owner.revoked) throw new Error('This account data is being deleted.');
  const operation = isDraft(draft)
    ? update(owner, drafts => [draft, ...drafts.filter(item => item.formId !== draft.formId)])
    : Promise.reject(new Error('This draft could not be saved. Check your answers and try again.'));
  const result = operation.then(() => true, () => false);
  owner.saveRevision += 1;
  if (typeof draft?.formId === 'string') owner.latestSaveResults.set(draft.formId, result);
  return operation;
}

export async function deleteDraft(formId: string): Promise<void> {
  const owner = currentOwner;
  const previousSave = owner.latestSaveResults.get(formId);
  await update(owner, drafts => drafts.filter(item => item.formId !== formId));
  // An intentional deletion releases an unsaved draft. A newer edit queued
  // after the deletion remains protected until that edit is safely persisted.
  if (owner.latestSaveResults.get(formId) === previousSave) {
    owner.latestSaveResults.delete(formId);
    owner.saveRevision += 1;
  }
}

/** Finish the current account's saves before signing out or replacing its editor. */
export async function waitForDraftSaves(): Promise<void> {
  const owner = currentOwner;
  while (true) {
    const revision = owner.saveRevision;
    const writes = pending;
    await writes;
    const results = await Promise.all(owner.latestSaveResults.values());
    if (writes !== pending || revision !== owner.saveRevision) continue;
    if (results.some(saved => !saved)) throw unsavedError();
    return;
  }
}

/** Select local drafts for one account. Guest drafts move only after explicit association. */
export async function setDraftOwner(ownerId: string | null, { claimGuest = false }: { claimGuest?: boolean } = {}): Promise<void> {
  validateOwnerId(ownerId);
  const source = currentOwner;
  const target = ownerContext(ownerId);
  const revision = source.saveRevision;
  // Capture only saves that precede this queue boundary. Waiting for a newer
  // save from inside this operation would deadlock the same queue.
  const saves = [...source.latestSaveResults.values()];
  return enqueue(async () => {
    const assertUnchanged = () => {
      if (source !== currentOwner || revision !== source.saveRevision) throw unsavedError();
    };
    assertUnchanged();
    if ((await Promise.all(saves)).some(saved => !saved)) throw unsavedError();
    assertUnchanged();
    if (source === target) return;
    if (claimGuest && (source.id === null || source.id.startsWith('guest-')) && target.id !== null) {
      const guestDrafts = await readDrafts(source);
      const accountDrafts = await readDrafts(target);
      assertUnchanged();
      if (guestDrafts.length) {
        const merged = new Map<string, SavedDraft>();
        for (const draft of [...accountDrafts, ...guestDrafts]) {
          const existing = merged.get(draft.formId);
          if (!existing || Date.parse(draft.updatedAt) > Date.parse(existing.updatedAt)) merged.set(draft.formId, draft);
        }
        await AsyncStorage.setItem(target.key, JSON.stringify([...merged.values()]));
        assertUnchanged();
        // Preserve the source if removal fails or an old editor changes during
        // removal. Restoring here precedes any newer queued guest write.
        try {
          await AsyncStorage.removeItem(source.key);
          assertUnchanged();
        } catch (error) {
          await AsyncStorage.setItem(source.key, JSON.stringify(guestDrafts));
          throw error;
        }
      }
    }
    assertUnchanged();
    currentOwner = target;
  });
}

/** Revoke synchronously so queued/stale editor callbacks cannot recreate erased data. */
export function revokeDraftOwner(ownerId: string | null): void {
  validateOwnerId(ownerId);
  ownerContext(ownerId).revoked = true;
}
export async function eraseDraftOwner(ownerId: string | null): Promise<void> {
  validateOwnerId(ownerId);
  const owner = ownerContext(ownerId);
  owner.revoked = true;
  return enqueue(async () => {
    await AsyncStorage.removeItem(owner.key);
    owner.latestSaveResults.clear();
    owner.saveRevision += 1;
  });
}
