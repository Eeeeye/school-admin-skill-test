import * as React from 'react';
import {
  Alert,
  Box,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography
} from '@mui/material';
import { Controller, UseFormReturn } from 'react-hook-form';
import { toast } from 'react-toastify';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { SerializedError } from '@reduxjs/toolkit';
import { LoadingButton } from '@mui/lab';
import { useNavigate } from 'react-router-dom';

import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { NoticeRecipient } from '../types';
import { useAddNoticeRecipientMutation, useUpdateNoticeRecipientMutation } from '../api';
import { useGetRoles } from '@/domains/staff/hooks';

type ManageNoticeRecipientsProps = {
  id?: number;
  operation: 'Add' | 'Edit';
  methods: UseFormReturn<NoticeRecipient>;
};

export const ManageNoticeRecipients: React.FC<ManageNoticeRecipientsProps> = ({
  id,
  operation,
  methods
}) => {
  const roles = useGetRoles();
  const [addNewRecipient, { isLoading: isAddingNoticeRecipient }] = useAddNoticeRecipientMutation();
  const [updateRecipient, { isLoading: isUpdatingNoticeRecipient }] =
    useUpdateNoticeRecipientMutation();
  const navigate = useNavigate();
  const {
    handleSubmit,
    formState: { errors },
    reset,
    control,
    watch,
    setValue
  } = methods;

  const selectedRole = Number(watch('roleId'));
  const group = selectedRole === 2 ? 'departments' : selectedRole === 3 ? 'classes' : 'none';
  const groupName = selectedRole === 2 ? 'Department' : selectedRole === 3 ? 'Class' : '';
  React.useEffect(() => {
    setValue('primaryDependentName', groupName);
    setValue('primaryDependentSelect', group);
  }, [group, groupName, setValue]);

  const handleSave = async (data: NoticeRecipient) => {
    try {
      const result =
        operation === 'Add'
          ? await addNewRecipient(data).unwrap()
          : await updateRecipient({ id: id!, ...data }).unwrap();

      reset();
      toast.info(result?.message);
      navigate('/app/notices/recipients');
    } catch (error) {
      toast.error(getErrorMsg(error as FetchBaseQueryError | SerializedError).message);
    }
  };

  return (
    <Box component={Paper} sx={{ p: 2 }}>
      <Typography variant='subtitle1' sx={{ mb: 3 }}>
        {' '}
        {operation} Notice Recipient
      </Typography>
      <form onSubmit={handleSubmit(handleSave)}>
        <FormControl fullWidth sx={{ mt: 2 }} size='small' error={Boolean(errors.roleId)}>
          <InputLabel id='role-for-dropdown' shrink>
            Recipient role
          </InputLabel>
          <Controller
            name='roleId'
            control={control}
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <>
                <Select
                  labelId='role-for-dropdown'
                  label='Recipient role'
                  value={value}
                  onChange={onChange}
                  notched
                >
                  {roles.map((role) => (
                    <MenuItem key={role.id} value={role.id}>
                      {role.name}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{error?.message}</FormHelperText>
              </>
            )}
          />
        </FormControl>
        <TextField
          label='Group recipients by'
          value={groupName || 'Whole role'}
          fullWidth
          size='small'
          sx={{ mt: 2 }}
          slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
        />
        <Alert severity='info' sx={{ mt: 2 }}>
          {group === 'departments'
            ? 'When publishing a notice, select a department to reach its teachers.'
            : group === 'classes'
              ? 'When publishing a notice, select a class to reach its students.'
              : 'Notices for this recipient group reach all members of the selected role.'}
        </Alert>

        <Box textAlign='center'>
          <LoadingButton
            type='submit'
            size='small'
            variant='contained'
            sx={{ mt: 4 }}
            loading={isAddingNoticeRecipient || isUpdatingNoticeRecipient}
          >
            Save
          </LoadingButton>
        </Box>
      </form>
    </Box>
  );
};
