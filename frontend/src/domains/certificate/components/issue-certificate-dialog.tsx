import { FormEvent, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { Link } from 'react-router-dom';
import { useGetStudentsQuery } from '@/domains/student/api/student-api';
import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { CertificateConfig, useIssueCertificateMutation } from '../api/certificate-api';
import { WalletPanel } from './wallet-panel';

export const IssueCertificateDialog = ({
  open,
  onClose,
  studentId,
  config
}: {
  open: boolean;
  onClose: () => void;
  studentId?: number;
  config?: CertificateConfig;
}) => {
  const { data, isLoading, error: studentsError } = useGetStudentsQuery({}, { skip: !open });
  const [selectedId, setSelectedId] = useState<number | undefined>(studentId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [validation, setValidation] = useState('');
  const [issue, { isLoading: saving, error }] = useIssueCertificateMutation();
  const students = data?.students || [];
  const attempt = useRef({ signature: '', key: '' });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setValidation('');
    if (!selectedId) return setValidation('Select a student.');
    if (!title.trim()) return setValidation('Enter a certificate title.');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim()) || /^0x0{40}$/i.test(address.trim())) {
      return setValidation('Enter a valid, non-zero Ethereum recipient address.');
    }
    const payloadSignature = JSON.stringify([
      selectedId,
      title.trim(),
      description.trim(),
      address.trim()
    ]);
    if (attempt.current.signature !== payloadSignature) {
      attempt.current = {
        signature: payloadSignature,
        key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
      };
    }
    try {
      await issue({
        idempotencyKey: attempt.current.key,
        studentId: selectedId,
        title: title.trim(),
        description: description.trim(),
        recipientAddress: address.trim()
      }).unwrap();
      onClose();
    } catch {
      // Keep form values and expose the server error; a stored operation can be retried from the list.
    }
  };
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth='sm'>
      <DialogTitle>Issue a student certificate</DialogTitle>
      <form onSubmit={save}>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity='info'>
              Certificate titles, descriptions and recipient addresses are public once issued. Do
              not include grades, contact details or other private student information without
              permission.
            </Alert>
            {studentsError && <Alert severity='error'>{getErrorMsg(studentsError).message}</Alert>}
            {!isLoading && !studentsError && students.length === 0 && (
              <Alert
                severity='info'
                action={
                  <Button component={Link} to='/app/students/add'>
                    Add student
                  </Button>
                }
              >
                Create a student record before issuing a certificate.
              </Alert>
            )}
            <Autocomplete
              options={students}
              loading={isLoading}
              value={students.find((student) => Number(student.id) === Number(selectedId)) || null}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              getOptionLabel={(student) => `${student.name} (#${student.id})`}
              onChange={(_event, student) => setSelectedId(student?.id)}
              renderInput={(params) => <TextField {...params} label='Student' required />}
              disabled={saving}
            />
            <TextField
              label='Certificate title'
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              inputProps={{ maxLength: 120 }}
              disabled={saving}
              placeholder='Course completion — Computer Science'
            />
            <TextField
              label='Description (public)'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              multiline
              minRows={3}
              inputProps={{ maxLength: 1000 }}
              disabled={saving}
            />
            <WalletPanel config={config} onUseAddress={setAddress} />
            <TextField
              label='Student’s recipient address'
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
              disabled={saving}
              placeholder='0x…'
              helperText='Confirm this address with the student before issuing. It cannot be changed afterwards.'
            />
            <Typography variant='body2' color='text.secondary'>
              The certificate will be saved and published to{' '}
              {config?.chainName || 'the school certificate network'}.
            </Typography>
            {(validation || error) && (
              <Alert severity='error'>{validation || getErrorMsg(error).message}</Alert>
            )}
            {error && (
              <Typography variant='body2'>
                If an operation was created, close this dialog and use its Retry action instead of
                issuing a duplicate.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type='submit'
            variant='contained'
            disabled={saving || !config?.available || Boolean(studentsError)}
          >
            {saving ? 'Issuing…' : 'Issue certificate'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
