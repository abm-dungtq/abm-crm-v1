import { createContext, useContext } from 'react';
import type { Actor } from './types';

export const ActorContext = createContext<Actor | null>(null);

export const canViewAudit = (role: Actor['role']) => role !== 'sale';

export function useActor() {
  const actor = useContext(ActorContext);
  if (!actor) throw new Error('useActor outside the authenticated shell');
  return actor;
}
