import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '../api';
import { useSession } from '../session';

/** Load a member endpoint whenever the screen comes into focus. Signs out on 401. */
export function useMemberQuery<T>(path: string) {
  const { memberToken, setMember } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!memberToken) return;
    setLoading(true);
    try {
      setData(await api<T>(path, { token: memberToken }));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await setMember(null);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, memberToken, setMember]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  return { data, error, loading, reload };
}
