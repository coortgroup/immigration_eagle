import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { deleteCloudAccount, signOutCloud, useCloudSession } from './cloudClient';
import { loadGuestProfile, readAccountPolicy, saveAccountPolicy, saveGuestProfile, readAccountDeletion, newAccountDeletion, saveAccountDeletion, clearAccountDeletion, resetDeletedAccountProfile, type AccountDeletion, type AccountPolicy, type GuestProfile } from './accountStorage';
import { setDraftOwner, waitForDraftSaves, revokeDraftOwner, eraseDraftOwner } from './draftStorage';
import { erasePaymentAttempts } from './payments';

type AccountState = {
  user: User | null; guest?: GuestProfile; ready: boolean; locked: boolean; scope?: string; error: string;
  retry: () => void; saveGuest: (details: Omit<GuestProfile, 'id'>) => Promise<void>; signOut: () => Promise<void>;
  recoverSignIn?: () => Promise<void>;
  deletionPending: boolean; deletionEmail?: string; deleteAccount: () => Promise<void>;
};
const Context = createContext<AccountState | null>(null);
export function useAccount(): AccountState {
  const value = useContext(Context);
  if (!value) throw new Error('AccountProvider is required.');
  return value;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const session = useCloudSession();
  const [deletion, setDeletion] = useState<AccountDeletion | null>(null);
  const deletionRef = useRef<AccountDeletion | null>(null);
  const deleting = useRef(false);
  const [guest, setGuest] = useState<GuestProfile>();
  const [policy, setPolicy] = useState<AccountPolicy>();
  const policyRef = useRef(policy); policyRef.current = policy;
  const [scope, setScope] = useState<string>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const transition = useRef<Promise<void>>(Promise.resolve());
  const draftOwner = useRef<{ id: string | null } | undefined>(undefined);
  const recoveryPending = useRef(false);
  const sessionUser = useRef(session.user); sessionUser.current = session.user;
  const hydrated = !!guest && !!policy;

  useEffect(() => {
    let active = true;
    if (hydrated) return;
    readAccountDeletion().then(async journal => ({ journal,
      profile: journal ? { id: 'deleting', name: '', email: '', phone: '' } : await loadGuestProfile(),
      settings: journal ? { loginRequired: !!journal.userId } : await readAccountPolicy(),
    })).then(({ profile, settings, journal }) => {
      if (active) {
        if (journal) { revokeDraftOwner(journal.ownerId); if (journal.clearLegacyGuest) revokeDraftOwner(null); }
        deletionRef.current = journal; setDeletion(journal);
        setGuest(profile); setPolicy(settings); setError('');
      }
    }).catch(() => { if (active) setError('Your account settings could not be read. Please try again.'); });
    return () => { active = false; };
  }, [hydrated, attempt]);

  useEffect(() => {
    if (!hydrated || session.loading || deletion) return;
    let active = true;
    setReady(false); setError('');
    const owner = session.user?.id || policyRef.current?.guestDraftOwner || null;
    const operation = transition.current.catch(() => undefined).then(async () => {
      if (!active) return;
      let settings = policyRef.current!;
      if (session.user) {
        const next = { ...settings, loginRequired: true, guestClaimedBy: settings.guestClaimedBy || owner! };
        // Commit the lock before associating private drafts. A failed write never
        // silently turns a registered account back into an unlocked guest.
        if (!settings.loginRequired || settings.guestClaimedBy !== next.guestClaimedBy) {
          await saveAccountPolicy(next);
          // Retain a committed reservation even if this effect was cancelled.
          policyRef.current = next; setPolicy(next);
        }
        settings = next;
        if (!active) return;
      }
      // Reauthentication to the same storage owner must reopen its retained
      // editor even when its latest local save failed. No account switch occurs.
      if (!draftOwner.current || draftOwner.current.id !== owner) {
        await setDraftOwner(owner, { claimGuest: !!owner && settings.guestClaimedBy === owner });
        // A cancelled effect can still have committed the storage boundary.
        draftOwner.current = { id: owner };
      }
      if (active) { setScope(owner || 'guest'); setReady(true); }
    });
    transition.current = operation;
    void operation.catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Your account could not be opened. Please try again.'); });
    return () => { active = false; };
  }, [hydrated, session.loading, session.user?.id, attempt, deletion]);

  const currentScope = session.user?.id || policy?.guestDraftOwner || 'guest';
  const canRecoverSignIn = !ready && !!error && !!session.user && !!draftOwner.current
    && draftOwner.current.id !== session.user.id;
  const value: AccountState = {
    user: session.user, guest, scope, ready: ready && scope === currentScope && !session.loading && !deletion,
    deletionPending: !!deletion, deletionEmail: deletion?.email || undefined,
    async deleteAccount() {
      if (deleting.current) return;
      deleting.current = true;
      try {
        await transition.current.catch(() => undefined);
        let journal = deletionRef.current;
        if (!journal) {
          if (!ready || scope !== currentScope || !draftOwner.current) throw new Error('Your account changed. Please open your profile again.');
          const id = sessionUser.current?.id || null;
          journal = newAccountDeletion(draftOwner.current.id, id, !!id && policyRef.current?.guestClaimedBy === id, sessionUser.current?.email || null);
          // Commit intent before revoking editors or issuing an irreversible remote request.
          await saveAccountDeletion(journal);
          deletionRef.current = journal; setDeletion(journal);
        }
        setReady(false); setError('');
        revokeDraftOwner(journal.ownerId);
        if (journal.clearLegacyGuest) revokeDraftOwner(null);
        if (journal.userId && !journal.cloudDeleted) {
          await deleteCloudAccount(journal.deletionToken, journal.userId);
          journal = { ...journal, cloudDeleted: true };
          await saveAccountDeletion(journal);
          deletionRef.current = journal; setDeletion(journal);
        }
        if (journal.userId) await erasePaymentAttempts(journal.userId);
        await eraseDraftOwner(journal.ownerId);
        if (journal.clearLegacyGuest && journal.ownerId !== null) await eraseDraftOwner(null);
        // Auth may already have removed this session. Never sign out a different user.
        if (journal.userId && sessionUser.current?.id && sessionUser.current.id !== journal.userId) throw new Error('Your signed-in account changed. Review your details and try again.');
        if (journal.userId) await signOutCloud();
        const fresh = await resetDeletedAccountProfile(journal.guestDraftOwner);
        await setDraftOwner(journal.guestDraftOwner);
        await clearAccountDeletion();
        draftOwner.current = { id: journal.guestDraftOwner };
        policyRef.current = fresh.policy; setPolicy(fresh.policy); setGuest(fresh.guest);
        setScope(journal.guestDraftOwner);
        deletionRef.current = null; setDeletion(null); setReady(true);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Account deletion has not been confirmed. Keep this screen open and try again.';
        setError(message); throw new Error(message);
      } finally { deleting.current = false; }
    },
    locked: !!policy?.loginRequired && !session.user, error,
    retry: () => { setError(''); setAttempt(count => count + 1); },
    recoverSignIn: canRecoverSignIn ? async () => {
      if (recoveryPending.current) return;
      // This cloud session never acquired the retained editor. Returning to login
      // leaves it and its failed-save guard attached to the original owner.
      if (sessionUser.current?.id !== session.user?.id || draftOwner.current?.id === session.user?.id) return;
      recoveryPending.current = true;
      try { await signOutCloud(); }
      catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not sign out. Please try again.');
      } finally { recoveryPending.current = false; }
    } : undefined,
    async saveGuest(details) {
      if (!guest || session.user || deletionRef.current) throw new Error('Your account changed. Please open your profile again.');
      const updated = { ...guest, ...details };
      await saveGuestProfile(updated); setGuest(updated);
    },
    async signOut() {
      if (deletionRef.current) throw new Error('Finish deleting your account before continuing.');
      await waitForDraftSaves();
      const settings = { ...policyRef.current!, loginRequired: true };
      await saveAccountPolicy(settings);
      policyRef.current = settings; setPolicy(settings);
      await signOutCloud();
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
