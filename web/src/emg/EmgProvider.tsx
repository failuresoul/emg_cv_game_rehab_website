import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { EmgEngine, type EmgStatus } from "./engine";

const EmgContext = createContext<EmgEngine | null>(null);

/** One EMG pipeline for the whole app: the connection lives across pages (from the session's
 * EMG step through every game). */
export function EmgProvider({ children, engine }: { children: ReactNode; engine?: EmgEngine }) {
  const [shared] = useState(() => engine ?? new EmgEngine());
  // Leaving the app closes the port cleanly, so the next visit can open it.
  useEffect(() => () => void shared.disconnect(), [shared]);
  return <EmgContext.Provider value={shared}>{children}</EmgContext.Provider>;
}

export function useEmgEngine(): EmgEngine {
  const engine = useContext(EmgContext);
  if (!engine) throw new Error("useEmgEngine must be used inside EmgProvider");
  return engine;
}

/** The connection's status, refreshed at most four times a second. */
export function useEmgStatus(): EmgStatus {
  const engine = useEmgEngine();
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getStatus(),
    () => engine.getStatus(),
  );
}
