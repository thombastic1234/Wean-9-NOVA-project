"use client";

import { createContext, useContext, useEffect, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { DEFAULT_SETTINGS } from "@/lib/contracts";
import { seedOrders } from "@/lib/fixtures";
import { initialState, reducer, restoreState, serializeState, STORAGE_KEY, type Action, type State } from "@/lib/store";

const StoreContext = createContext<{ state: State; dispatch: Dispatch<Action>; storageNotice: string } | null>(null);

export function OrderProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [storageNotice, setStorageNotice] = useState("");
  useEffect(() => {
    let saved;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = restoreState(raw);
    } catch {
      setStorageNotice("Saved state could not be restored. Fresh demo orders are loaded; persistence will retry.");
    }
    dispatch({ type: "hydrate", orders: saved?.orders ?? seedOrders(), settings: saved?.settings ?? DEFAULT_SETTINGS });
  }, []);
  useEffect(() => {
    // The first render is deliberately empty. Never overwrite storage before hydration.
    if (!state.hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, serializeState(state)); }
    catch { setStorageNotice("Browser storage is unavailable. This session works, but refresh may lose changes."); }
  }, [state.hydrated, state.orders, state.settings]);
  return <StoreContext.Provider value={{ state, dispatch, storageNotice }}>{children}</StoreContext.Provider>;
}

export function useOrders() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useOrders must be inside OrderProvider");
  return context;
}
