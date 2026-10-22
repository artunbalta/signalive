"use client";

import { useSyncExternalStore } from "react";

/** A tiny observable store for state shared outside the React tree. */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(l: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === "function" ? patch(state) : patch;
      let changed = false;
      for (const k of Object.keys(p) as (keyof T)[]) {
        if (!Object.is(state[k], p[k])) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
