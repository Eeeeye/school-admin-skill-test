import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { AccountBalanceWalletOutlined } from '@mui/icons-material';
import { CertificateConfig } from '../api/certificate-api';
import { useWallet } from '../hooks/use-wallet';
import { walletRpcUrl } from '../hooks/wallet-network';

export const WalletPanel = ({
  config,
  onUseAddress
}: {
  config?: CertificateConfig;
  onUseAddress?: (address: string) => void;
}) => {
  const wallet = useWallet();
  const wrongNetwork = Boolean(
    wallet.address && config?.chainId && wallet.chainId !== Number(config.chainId)
  );
  const publicRpc = walletRpcUrl(config?.rpcUrl, window.location.origin);
  return (
    <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <AccountBalanceWalletOutlined color='primary' />
        <Typography variant='subtitle2' sx={{ flex: 1 }}>
          Recipient wallet (optional)
        </Typography>
        <Button variant='outlined' onClick={wallet.connect} disabled={wallet.busy}>
          {wallet.address ? 'Connect another account' : 'Connect wallet'}
        </Button>
      </Stack>
      <Typography variant='body2' color='text.secondary' sx={{ mt: 1 }}>
        Connect to use a wallet address, or enter the student’s address manually. The school issues
        certificates; connecting your wallet does not sign or pay for a transaction.
      </Typography>
      {wallet.address && (
        <Typography sx={{ mt: 1, overflowWrap: 'anywhere' }}>{wallet.address}</Typography>
      )}
      {wallet.address && onUseAddress && (
        <Button onClick={() => onUseAddress(wallet.address)} sx={{ mt: 1 }}>
          Use this recipient address
        </Button>
      )}
      {wrongNetwork && config && (
        <Alert
          severity='info'
          sx={{ mt: 1 }}
          action={
            publicRpc ? (
              <Button
                color='inherit'
                disabled={wallet.busy}
                onClick={() => wallet.switchChain(config)}
              >
                Switch network
              </Button>
            ) : undefined
          }
        >
          Connected to a different network. Certificates use {config.chainName}.
          {!publicRpc &&
            ' You can still use this address; the school submits transactions for you.'}
        </Alert>
      )}
      {wallet.error && (
        <Alert severity='warning' sx={{ mt: 1 }}>
          {wallet.error}
        </Alert>
      )}
    </Box>
  );
};
