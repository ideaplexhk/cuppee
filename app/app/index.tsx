import { Redirect } from 'expo-router';
import { useSession } from '../src/session';
import { Loading } from '../src/components/ui';

export default function Index() {
  const { ready, memberToken, staffToken } = useSession();
  if (!ready) return <Loading />;
  // A café tablet stays in staff mode across restarts.
  if (staffToken) return <Redirect href="/staff" />;
  return <Redirect href={memberToken ? '/card' : '/sign-in'} />;
}
