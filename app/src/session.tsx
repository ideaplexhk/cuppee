import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { store } from './storage';

type Staff = { id: string; name: string; role: string; cafeId: string };
type State = {
  ready: boolean;
  memberToken: string | null;
  staffToken: string | null;
  staff: Staff | null;
};
type Ctx = State & {
  setMember: (token: string | null) => Promise<void>;
  setStaff: (token: string | null, staff?: Staff | null) => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State>({ ready: false, memberToken: null, staffToken: null, staff: null });

  useEffect(() => {
    (async () => {
      const [memberToken, staffToken, staffJson] = await Promise.all([store.get('memberToken'), store.get('staffToken'), store.get('staff')]);
      setS({ ready: true, memberToken, staffToken, staff: staffJson ? JSON.parse(staffJson) : null });
    })();
  }, []);

  const setMember = useCallback(async (token: string | null) => {
    await store.set('memberToken', token);
    setS((p) => ({ ...p, memberToken: token }));
  }, []);

  const setStaff = useCallback(async (token: string | null, staff: Staff | null = null) => {
    await store.set('staffToken', token);
    await store.set('staff', token && staff ? JSON.stringify(staff) : null);
    setS((p) => ({ ...p, staffToken: token, staff: token ? staff : null }));
  }, []);

  const value = useMemo(() => ({ ...s, setMember, setStaff }), [s, setMember, setStaff]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error('useSession outside SessionProvider'); // i18n-ignore: developer error
  return c;
}
