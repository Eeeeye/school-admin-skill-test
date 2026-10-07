import { isAction, Middleware } from '@reduxjs/toolkit';
import { api } from '@/api';
import { advanceAuthSession } from '@/api/auth-session';
import { persistor } from './store';

let persistenceCleanup = Promise.resolve();

export const purgeMiddleware: Middleware = (store) => (next) => (action) => {
  const changesSession =
    isAction(action) && ['auth/resetUser', 'auth/setUser'].includes(action.type);
  const fromAnotherTab =
    isAction(action) &&
    'meta' in action &&
    (action.meta as { authSessionRemote?: boolean } | undefined)?.authSessionRemote === true;
  if (changesSession) advanceAuthSession(!fromAnotherTab);
  // Authentication must reach the reducer before navigation and cache subscribers run.
  const result = next(action);
  if (changesSession) {
    store.dispatch(api.util.resetApiState());
    persistor.pause();
    persistenceCleanup = persistenceCleanup
      .then(async () => {
        await persistor.flush();
        await persistor.purge();
      })
      .catch(() => {
        // In-memory auth and query data are already cleared if browser storage is unavailable.
      })
      .finally(() => persistor.persist());
  }
  return result;
};
