import { FormEvent, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { ArrowBack, VerifiedOutlined } from '@mui/icons-material';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { isUserAuthenticated } from '@/domains/auth/slice';
import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { useVerifyCertificateQuery } from '../api/certificate-api';

const validId = (id: string) => /^0x[0-9a-fA-F]{64}$/.test(id);
const displayDate = (value?: string) => (value ? new Date(value).toLocaleString() : '—');
const safeLink = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};
export const VerifyCertificatePage = () => {
  const { id } = useParams();
  const [input, setInput] = useState(id || '');
  const [validation, setValidation] = useState('');
  const navigate = useNavigate();
  const authenticated = useSelector(isUserAuthenticated);
  const query = useVerifyCertificateQuery(id || '', {
    skip: !id || !validId(id),
    refetchOnMountOrArgChange: true
  });
  useEffect(() => {
    setInput(id || '');
  }, [id]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    let certificateId = input.trim();
    try {
      const url = new URL(certificateId);
      certificateId = url.pathname.split('/').filter(Boolean).pop() || '';
    } catch {
      /* The input can be an ID instead of a link. */
    }
    if (!validId(certificateId)) {
      setValidation(
        'Enter a certificate ID starting with 0x and 64 hexadecimal characters, or paste its verification link.'
      );
      return;
    }
    setValidation('');
    if (id === certificateId) query.refetch();
    else navigate(`/verify/${certificateId}`);
  };
  const data = query.currentData;
  const metadataUrl = safeLink(data?.metadataUrl);
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, md: 7 } }}>
      <Container maxWidth='md'>
        <Stack spacing={3}>
          <Button
            component={Link}
            to={authenticated ? '/app' : '/auth/login'}
            startIcon={<ArrowBack />}
            sx={{ alignSelf: 'start' }}
          >
            {authenticated ? 'School dashboard' : 'School sign in'}
          </Button>
          <Box>
            <Stack direction='row' spacing={1} alignItems='center'>
              <VerifiedOutlined color='primary' fontSize='large' />
              <Typography variant='h4'>Verify a certificate</Typography>
            </Stack>
            <Typography color='text.secondary' sx={{ mt: 1 }}>
              Check the school’s certificate registry. No account or wallet is required.
            </Typography>
          </Box>
          <Paper variant='outlined' sx={{ p: 3 }}>
            <form onSubmit={submit}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  label='Certificate ID or verification link'
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  fullWidth
                  required
                />
                <Button
                  type='submit'
                  variant='contained'
                  disabled={query.isFetching}
                  sx={{ minWidth: 100 }}
                >
                  Verify
                </Button>
              </Stack>
            </form>
            {(validation || (id && !validId(id))) && (
              <Alert severity='warning' sx={{ mt: 2 }}>
                {validation || 'This certificate ID is invalid. Check the link and try again.'}
              </Alert>
            )}
          </Paper>
          {query.isFetching && (
            <Stack direction='row' spacing={2} alignItems='center'>
              <CircularProgress size={24} />
              <Typography>Checking the certificate network…</Typography>
            </Stack>
          )}
          {query.isError && (
            <Alert
              severity='error'
              action={
                <Button color='inherit' onClick={() => query.refetch()}>
                  Retry
                </Button>
              }
            >
              Verification could not be completed. {getErrorMsg(query.error).message} No conclusion
              about validity can be drawn until the check succeeds.
            </Alert>
          )}
          {data && !query.isFetching && !query.isError && (
            <Paper variant='outlined' sx={{ p: { xs: 2, md: 4 } }}>
              <Alert
                severity={
                  data.valid
                    ? 'success'
                    : data.status === 'revoked' || data.status === 'invalid'
                      ? 'error'
                      : 'warning'
                }
                sx={{ mb: 3 }}
              >
                <Typography fontWeight={700}>
                  {data.valid
                    ? 'Valid certificate'
                    : data.status === 'revoked'
                      ? 'Certificate revoked'
                      : data.status === 'invalid'
                        ? 'Certificate data does not match'
                        : 'No issued certificate found'}
                </Typography>
                {data.valid
                  ? 'The configured school registry confirms this certificate is issued and has not been revoked.'
                  : data.status === 'revoked'
                    ? 'This certificate was issued but is no longer valid.'
                    : data.status === 'invalid'
                      ? 'The certificate metadata does not match the school’s issuance record. Do not rely on this credential.'
                      : 'The configured registry has no issued certificate with this ID. Check the ID and the issuing school.'}
              </Alert>
              {data.chainId === 31337 && (
                <Alert severity='info' sx={{ mb: 3 }}>
                  This certificate belongs to an isolated demonstration registry. It is not a
                  production credential, and the demonstration network can be reset.
                </Alert>
              )}
              {data.exists && (
                <>
                  <Typography variant='h5'>{data.title || 'Student certificate'}</Typography>
                  {data.description && (
                    <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                      {data.description}
                    </Typography>
                  )}
                  <Chip
                    label={data.status}
                    color={data.valid ? 'success' : 'error'}
                    size='small'
                    sx={{ mt: 2 }}
                  />
                  <Divider sx={{ my: 3 }} />
                  <Stack spacing={2}>
                    <Detail label='Recipient wallet' value={data.recipientAddress} />
                    <Detail label='Issued' value={displayDate(data.issuedAt)} />
                    {data.revokedAt && (
                      <Detail label='Revoked' value={displayDate(data.revokedAt)} />
                    )}
                    <Detail label='Issuer wallet' value={data.issuerAddress} />
                    <Detail label='Metadata CID' value={data.metadataCid} />
                    {metadataUrl && (
                      <MuiLink href={metadataUrl} target='_blank' rel='noopener noreferrer'>
                        View certificate metadata on IPFS
                      </MuiLink>
                    )}
                    <Detail label='Issuance transaction' value={data.transactionHash} />
                  </Stack>
                  <Divider sx={{ my: 3 }} />
                </>
              )}
              <Stack spacing={2}>
                <Detail label='Certificate ID' value={data.id} />
                <Detail label='Registry contract' value={data.contractAddress} />
                <Detail label='Network chain ID' value={String(data.chainId)} />
              </Stack>
              <Typography variant='body2' color='text.secondary' sx={{ mt: 3 }}>
                Registry validity confirms the issuance and revocation record. Confirm the issuing
                school and recipient separately before relying on a credential.
              </Typography>
            </Paper>
          )}
        </Stack>
      </Container>
    </Box>
  );
};
const Detail = ({ label, value }: { label: string; value?: string }) => (
  <Box>
    <Typography variant='caption' color='text.secondary'>
      {label}
    </Typography>
    <Typography sx={{ overflowWrap: 'anywhere' }}>{value || '—'}</Typography>
  </Box>
);
