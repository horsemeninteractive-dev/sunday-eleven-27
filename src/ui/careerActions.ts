import { useSyncExternalStore } from 'react';
import { gameActions } from './hooks';

let loading = false;
const listeners = new Set<() => void>();
function publish(value: boolean) { loading = value; listeners.forEach((listener) => listener()); }
export function useCareerLoading() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => loading, () => false);
}
export async function loadCareer(slot: string) {
  if (loading) return;
  publish(true);
  try { await gameActions().loadGame(slot); }
  finally { publish(false); }
}
