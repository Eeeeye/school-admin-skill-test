import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { Add, ContentCopy, Refresh, VerifiedOutlined } from '@mui/icons-material';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { getUserRole } from '@/domains/auth/slice';
import { getErrorMsg } from '@/utils/helpers/get-error-message';
import {
  Certificate,
  useGetCertificateConfigQuery,
  useGetCertificatesQuery,
  useRetryCertificateMutation,
  useRevokeCertificateMutation
} from '../api/certificate-api';
import { IssueCertificateDialog } from '../components/issue-certificate-dialog';
import { WalletPanel } from '../components/wallet-panel';

const statusColor = {
  issued: 'success',
  revoked: 'error',
  pending: 'warning',
  failed: 'error'
} as const;
const displayDate = (value?: string) => (value ? new Date(value).toLocaleString() : '—');
export const CertificatesPage = () => {
  const role = useSelector(getUserRole);
  const admin = role === 'admin';
  const [params, setParams] = useSearchParams();
  const studentId = Number(params.get('studentId')) || undefined;
  const [search, setSearch] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null);
  const [actionError, setActionError] = useState('');
  const config = useGetCertificateConfigQuery();
  const list = useGetCertificatesQuery(studentId, { pollingInterval: 15000 });
  const [revoke, revocation] = useRevokeCertificateMutation();
  const [retry, retryState] = useRetryCertificateMutation();
  const records = list.data?.certificates || [];
  const filtered = records.filter((record) =>
    `${record.title} ${record.studentName} ${record.id} ${record.recipientAddress}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const publicPath = (id: string) => `/verify/${id}`;
  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath(id)}`);
      toast.success('Verification link copied.');
    } catch {
      toast.info('Open Verify, then copy the address from your browser.');
    }
  };
  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setActionError('');
    try {
      const result = await revoke(revokeTarget.id).unwrap();
      toast.info(
        result.certificate.status === 'revoked'
          ? 'Certificate revoked.'
          : 'Revocation is processing. Refresh to check its status.'
      );
      setRevokeTarget(null);
    } catch (error) {
      setActionError(getErrorMsg(error as Parameters<typeof getErrorMsg>[0]).message);
    }
  };
  const retryIssue = async (id: string) => {
    setActionError('');
    try {
      const result = await retry(id).unwrap();
      toast.info(
        result.certificate.status === 'issued'
          ? 'Certificate issued.'
          : 'Status refreshed. Processing may take a moment.'
      );
    } catch (error) {
      setActionError(getErrorMsg(error as Parameters<typeof getErrorMsg>[0]).message);
    }
  };
  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent='space-between' spacing={2}>
        <Box>
          <Typography variant='h4'>Certificates</Typography>
          <Typography color='text.secondary'>
            Student achievements, with independently verifiable records.
          </Typography>
        </Box>
        <Stack direction='row' spacing={1} alignItems='center'>
          <Button component={Link} to='/verify' startIcon={<VerifiedOutlined />}>
            Verify a certificate
          </Button>
          {admin && (
            <Button
              variant='contained'
              startIcon={<Add />}
              onClick={() => setIssueOpen(true)}
              disabled={!config.data?.available}
            >
              Issue certificate
            </Button>
          )}
        </Stack>
      </Stack>
      {config.data?.demoMode && (
        <Alert severity='info'>
          Local demonstration network. Verification links work only while this installation is
          running and accessible; these are not production credentials.
        </Alert>
      )}
      {(config.error || (config.data && !config.data.available)) && (
        <Alert
          severity='warning'
          action={
            <Button color='inherit' onClick={() => config.refetch()}>
              Retry
            </Button>
          }
        >
          Certificate publishing is temporarily unavailable.{' '}
          {config.data?.error || getErrorMsg(config.error).message}
        </Alert>
      )}
      {role === 'student' && <WalletPanel config={config.data} />}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField
          label='Search title, student, address or certificate ID'
          size='small'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ flex: 1 }}
        />
        {studentId && <Chip label={`Student #${studentId}`} onDelete={() => setParams({})} />}
        <Button
          startIcon={<Refresh />}
          onClick={() => {
            list.refetch();
            config.refetch();
          }}
          disabled={list.isFetching}
        >
          Refresh
        </Button>
      </Stack>
      {actionError && !revokeTarget && (
        <Alert severity='error' onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}
      {list.isLoading && <CircularProgress aria-label='Loading certificates' />}
      {list.error && <Alert severity='error'>{getErrorMsg(list.error).message}</Alert>}
      {!list.isLoading && !list.error && filtered.length === 0 && (
        <Card variant='outlined'>
          <CardContent>
            <Typography variant='h6'>
              {search ? 'No matching certificates' : 'No certificates yet'}
            </Typography>
            <Typography color='text.secondary'>
              {admin
                ? 'Issue a certificate for a student to start their record.'
                : 'Your school-issued certificates will appear here.'}
            </Typography>
          </CardContent>
        </Card>
      )}
      {filtered.map((certificate) => (
        <Card key={certificate.id} variant='outlined'>
          <CardContent>
            <Stack direction='row' spacing={2} justifyContent='space-between' alignItems='start'>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant='h6' sx={{ overflowWrap: 'anywhere' }}>
                  {certificate.title}
                </Typography>
                <Typography color='text.secondary'>
                  {admin && certificate.studentId ? (
                    <MuiLink component={Link} to={`/app/students/${certificate.studentId}`}>
                      {certificate.studentName || `Student #${certificate.studentId}`}
                    </MuiLink>
                  ) : (
                    certificate.studentName || 'Student record'
                  )}
                </Typography>
              </Box>
              <Chip
                label={certificate.status}
                color={statusColor[certificate.status]}
                size='small'
              />
            </Stack>
            {certificate.description && (
              <Typography sx={{ my: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {certificate.description}
              </Typography>
            )}
            <Typography variant='body2' color='text.secondary' sx={{ mt: 1 }}>
              Created {displayDate(certificate.createdAt)}
              {certificate.issuedAt ? ` · Issued ${displayDate(certificate.issuedAt)}` : ''}
              {certificate.revokedAt ? ` · Revoked ${displayDate(certificate.revokedAt)}` : ''}
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Typography variant='body2' sx={{ overflowWrap: 'anywhere' }}>
              Recipient: {certificate.recipientAddress}
            </Typography>
            <Typography variant='body2' color='text.secondary' sx={{ overflowWrap: 'anywhere' }}>
              Certificate ID: {certificate.id}
            </Typography>
            {certificate.status === 'pending' && (
              <Alert severity='info' sx={{ mt: 2 }}>
                This operation is still processing. Use Refresh or Retry to reconcile its network
                status.
              </Alert>
            )}
            {(certificate.status === 'failed' ||
              (certificate.status === 'issued' && certificate.error)) && (
              <Alert severity='error' sx={{ mt: 2 }}>
                {certificate.error ||
                  'Issuance did not complete. An administrator can retry this record.'}
              </Alert>
            )}
          </CardContent>
          <CardActions sx={{ px: 2, pb: 2, gap: 1, flexWrap: 'wrap' }}>
            <Button
              component={Link}
              to={publicPath(certificate.id)}
              startIcon={<VerifiedOutlined />}
            >
              Verify
            </Button>
            {(certificate.status === 'issued' || certificate.status === 'revoked') && (
              <Button startIcon={<ContentCopy />} onClick={() => copy(certificate.id)}>
                Copy verification link
              </Button>
            )}
            {admin && (certificate.status === 'failed' || certificate.status === 'pending') && (
              <Button
                disabled={retryState.isLoading || !config.data?.available}
                onClick={() => retryIssue(certificate.id)}
              >
                Retry / check operation
              </Button>
            )}
            {admin && certificate.status === 'issued' && (
              <Button
                color='error'
                disabled={!config.data?.available}
                onClick={() => {
                  setActionError('');
                  setRevokeTarget(certificate);
                }}
              >
                {certificate.revocationTransactionHash ? 'Check revocation' : 'Revoke'}
              </Button>
            )}
          </CardActions>
        </Card>
      ))}
      {issueOpen && (
        <IssueCertificateDialog
          open
          onClose={() => {
            setIssueOpen(false);
            list.refetch();
          }}
          studentId={studentId}
          config={config.data}
        />
      )}
      <Dialog
        open={Boolean(revokeTarget)}
        onClose={revocation.isLoading ? undefined : () => setRevokeTarget(null)}
        fullWidth
        maxWidth='sm'
      >
        <DialogTitle>Revoke this certificate?</DialogTitle>
        <DialogContent>
          <Typography>
            “{revokeTarget?.title}” will no longer be valid. Its public record remains visible. This
            cannot be undone.
          </Typography>
          {actionError && (
            <Alert severity='error' sx={{ mt: 2 }}>
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={revocation.isLoading} onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button
            color='error'
            variant='contained'
            disabled={revocation.isLoading}
            onClick={confirmRevoke}
          >
            {revocation.isLoading ? 'Revoking…' : 'Revoke certificate'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
