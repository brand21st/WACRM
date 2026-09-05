"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Lets the inbox page tell the dashboard chrome to get out of the way
 * on mobile when a conversation is open — WhatsApp-style full-screen
 * chat. Desktop (`lg+`) ignores `immersive` and keeps the global header.
 *
 * Defaults are safe no-ops so a Header rendered outside the provider
 * (tests, isolated stories) still mounts.
 */
interface InboxChromeContextValue {
  immersive: boolean;
  setImmersive: (next: boolean) => void;
}

const InboxChromeContext = createContext<InboxChromeContextValue>({
  immersive: false,
  setImmersive: () => {},
});

export function InboxChromeProvider({ children }: { children: ReactNode }) {
  const [immersive, setImmersiveState] = useState(false);
  const setImmersive = useCallback((next: boolean) => {
    setImmersiveState(next);
  }, []);
  const value = useMemo(
    () => ({ immersive, setImmersive }),
    [immersive, setImmersive],
  );
  return (
    <InboxChromeContext.Provider value={value}>
      {children}
    </InboxChromeContext.Provider>
  );
}

export function useInboxChrome() {
  return useContext(InboxChromeContext);
}
