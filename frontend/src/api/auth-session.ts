type AuthSession = {
  epoch: number;
  signal: AbortSignal;
};

const SESSION_EVENT_KEY = 'school-admin:session-change';
let controller = new AbortController();
let session: AuthSession = { epoch: 0, signal: controller.signal };
let channel: BroadcastChannel | null = null;
let lastEventNonce = '';
const seenEvents = new Set<string>();

const rememberEvent = (nonce: string) => {
  lastEventNonce = nonce;
  seenEvents.add(nonce);
  if (seenEvents.size > 256) seenEvents.delete(seenEvents.values().next().value!);
};

const clearPersistedTabIdentity = (nonce: string) => {
  try {
    window.sessionStorage.removeItem('persist:root');
    window.sessionStorage.setItem(SESSION_EVENT_KEY, nonce);
  } catch {
    // In-memory invalidation still works when browser storage is unavailable.
  }
};

// Run before redux-persist reads storage; a resumed tab must not restore an old identity.
export const prepareAuthSessionStorage = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('persist:root');
    const latest = window.localStorage.getItem(SESSION_EVENT_KEY);
    if (latest && window.sessionStorage.getItem(SESSION_EVENT_KEY) !== latest) {
      clearPersistedTabIdentity(latest);
    }
  } catch {
    // The application can continue without persisted auth.
  }
};

const publishSessionChange = () => {
  if (typeof window === 'undefined') return;
  // Only a random event ID crosses tabs: no identity, password, token or profile data.
  rememberEvent(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  clearPersistedTabIdentity(lastEventNonce);
  try {
    window.localStorage.setItem(SESSION_EVENT_KEY, lastEventNonce);
  } catch {
    // BroadcastChannel also works when persistent browser storage is unavailable.
  }
  try {
    channel?.postMessage(lastEventNonce);
  } catch {
    // The storage event remains a fallback when BroadcastChannel is unavailable.
  }
};

export const getAuthSession = () => session;

export const advanceAuthSession = (broadcast = true) => {
  const previous = controller;
  controller = new AbortController();
  session = { epoch: session.epoch + 1, signal: controller.signal };
  previous.abort();
  if (broadcast) publishSessionChange();
  return session;
};

export const isAuthSessionCurrent = (candidate: AuthSession) =>
  candidate === session && !candidate.signal.aborted;

export const observeAuthSessionChanges = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const receive = (nonce: unknown) => {
    if (typeof nonce !== 'string' || !nonce || seenEvents.has(nonce)) return;
    rememberEvent(nonce);
    clearPersistedTabIdentity(nonce);
    onChange();
  };
  const readLatestNonce = () => {
    try {
      return window.localStorage.getItem(SESSION_EVENT_KEY);
    } catch {
      return null;
    }
  };
  const latestNonce = readLatestNonce();
  if (latestNonce) rememberEvent(latestNonce);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_EVENT_KEY) receive(event.newValue);
  };
  // Recheck after suspension/backgrounding, in case a storage event was delayed.
  const onFocus = () => receive(readLatestNonce());
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onFocus);
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(SESSION_EVENT_KEY);
      channel.onmessage = (event: MessageEvent) => receive(event.data);
    }
  } catch {
    channel = null;
  }
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onFocus);
    channel?.close();
    channel = null;
  };
};
