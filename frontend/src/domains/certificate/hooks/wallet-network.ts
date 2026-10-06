const isLoopback = (hostname: string) =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  hostname === '0.0.0.0' ||
  /^127\./.test(hostname);

// A server's private RPC must never become a visitor's localhost connection.
// An empty URL means wallet connection is for recipient addresses only.
export const walletRpcUrl = (configuredUrl: string | null | undefined, pageOrigin: string) => {
  if (!configuredUrl?.trim()) return undefined;
  try {
    const rpc = new URL(configuredUrl);
    const page = new URL(pageOrigin);
    if (!['http:', 'https:'].includes(rpc.protocol) || rpc.username || rpc.password) {
      return undefined;
    }
    if (isLoopback(rpc.hostname) && !isLoopback(page.hostname)) return undefined;
    if (page.protocol === 'https:' && rpc.protocol !== 'https:') return undefined;
    return rpc.href;
  } catch {
    return undefined;
  }
};
