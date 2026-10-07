import {
  BaseQueryFn,
  createApi,
  FetchArgs,
  fetchBaseQuery,
  FetchBaseQueryError
} from '@reduxjs/toolkit/query/react';
import Cookies from 'js-cookie';
import { Tag } from './tag-types';
import { resetUser } from '@/domains/auth/slice';
import { advanceAuthSession, getAuthSession, isAuthSessionCurrent } from './auth-session';

const baseQuery = fetchBaseQuery({
  baseUrl: `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/v1`,
  prepareHeaders: (headers) => {
    const csrfToken = Cookies.get('csrfToken');
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }

    return headers;
  },
  credentials: 'include'
});

// Refreshes belong to the session that started them, never to a later login.
let refreshInFlight: {
  session: ReturnType<typeof getAuthSession>;
  promise: Promise<boolean>;
} | null = null;
let refreshGeneration = 0;

const sessionChanged = (): { error: FetchBaseQueryError } => ({
  error: { status: 'CUSTOM_ERROR', error: 'Your session changed. Please retry this action.' }
});

const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  queryApi,
  extraOptions
) => {
  const url = typeof args === 'string' ? args : args.url;
  const isPublicAuth = ['/auth/login', '/auth/refresh', '/auth/setup-password'].includes(url);
  const requestSession = ['/auth/login', '/auth/logout'].includes(url)
    ? advanceAuthSession()
    : getAuthSession();
  const isCurrent = () => isAuthSessionCurrent(requestSession);
  const controller = new AbortController();
  const abort = () => controller.abort();
  requestSession.signal.addEventListener('abort', abort);
  queryApi.signal.addEventListener('abort', abort);
  if (requestSession.signal.aborted || queryApi.signal.aborted) abort();
  const requestApi = { ...queryApi, signal: controller.signal };

  try {
    if (!isPublicAuth && refreshInFlight?.session === requestSession) {
      const refreshed = await refreshInFlight.promise;
      if (!isCurrent() || controller.signal.aborted) return sessionChanged();
      if (!refreshed) {
        return {
          error: {
            status: 'CUSTOM_ERROR',
            error: 'Unable to refresh your session. Please try again.'
          }
        };
      }
    }
    if (!isCurrent() || controller.signal.aborted) return sessionChanged();
    const requestGeneration = refreshGeneration;
    let result = await baseQuery(args, requestApi, extraOptions);
    if (!isCurrent() || controller.signal.aborted) return sessionChanged();
    if (!isPublicAuth && result.error?.status === 401) {
      // An old 401 may arrive after another request refreshed this same session.
      if (requestGeneration !== refreshGeneration) {
        result = await baseQuery(args, requestApi, extraOptions);
        return isCurrent() && !controller.signal.aborted ? result : sessionChanged();
      }
      if (!refreshInFlight || refreshInFlight.session !== requestSession) {
        const refresh = { session: requestSession, promise: Promise.resolve(false) };
        refresh.promise = (async () => {
          // Refresh is independent of one component's cancellation, but is aborted on account changes.
          const refreshResult = await baseQuery(
            '/auth/refresh',
            { ...queryApi, signal: requestSession.signal },
            extraOptions
          );
          if (!isCurrent()) return false;
          if (refreshResult.data) {
            refreshGeneration += 1;
            return true;
          }
          // Temporary network/server errors do not erase a valid local session.
          if (refreshResult.error?.status === 401 || refreshResult.error?.status === 403) {
            queryApi.dispatch(resetUser());
          }
          return false;
        })().finally(() => {
          if (refreshInFlight === refresh) refreshInFlight = null;
        });
        refreshInFlight = refresh;
      }
      const refreshed = await refreshInFlight.promise;
      if (!isCurrent() || controller.signal.aborted) return sessionChanged();
      if (refreshed) {
        result = await baseQuery(args, requestApi, extraOptions);
        if (!isCurrent() || controller.signal.aborted) return sessionChanged();
      }
    }
    return result;
  } finally {
    requestSession.signal.removeEventListener('abort', abort);
    queryApi.signal.removeEventListener('abort', abort);
  }
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: Object.values(Tag),
  endpoints: () => ({})
});
