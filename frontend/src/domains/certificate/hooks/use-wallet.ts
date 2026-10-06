import { useCallback, useEffect, useState } from 'react';
import { CertificateConfig } from '../api/certificate-api';
import { walletRpcUrl } from './wallet-network';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
const getProvider = () => (window as Window & { ethereum?: EthereumProvider }).ethereum;
const firstAccount = (value: unknown) =>
  Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
const walletError = (error: unknown) => {
  const detail = error as { code?: number; message?: string };
  if (detail.code === 4001) return 'The wallet request was cancelled. You can try again.';
  if (detail.code === -32002) return 'A request is already open. Check your wallet.';
  return detail.message || 'Could not connect to your wallet.';
};

export const useWallet = () => {
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState<number>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;
    const accountsChanged = (...args: unknown[]) => setAddress(firstAccount(args[0]));
    const chainChanged = (...args: unknown[]) => setChainId(Number(args[0]));
    const disconnected = () => {
      setAddress('');
      setChainId(undefined);
    };
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    provider.on?.('disconnect', disconnected);
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
      provider.removeListener?.('disconnect', disconnected);
    };
  }, []);
  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setError(
        'No wallet detected. Open this page in a browser with MetaMask, or enter the recipient address manually.'
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      setAddress(firstAccount(await provider.request({ method: 'eth_requestAccounts' })));
      setChainId(Number(await provider.request({ method: 'eth_chainId' })));
    } catch (error) {
      setError(walletError(error));
    } finally {
      setBusy(false);
    }
  }, []);
  const switchChain = useCallback(async (config: CertificateConfig) => {
    const provider = getProvider();
    if (!provider) return;
    const rpcUrl = walletRpcUrl(config.rpcUrl, window.location.origin);
    if (!rpcUrl) {
      setError(
        'This school network has no public wallet RPC. You can still use your wallet address.'
      );
      return;
    }
    setBusy(true);
    setError('');
    const target = `0x${Number(config.chainId).toString(16)}`;
    try {
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: target }]
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: target,
              chainName: config.chainName,
              rpcUrls: [rpcUrl],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
            }
          ]
        });
      }
      setChainId(Number(await provider.request({ method: 'eth_chainId' })));
    } catch (error) {
      setError(walletError(error));
    } finally {
      setBusy(false);
    }
  }, []);
  return { address, chainId, error, busy, connect, switchChain };
};
