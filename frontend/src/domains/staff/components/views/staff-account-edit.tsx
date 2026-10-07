import * as React from 'react';
import { Edit } from '@mui/icons-material';
import { Alert, LinearProgress, Paper, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoadingButton } from '@mui/lab';
import { toast } from 'react-toastify';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { SerializedError } from '@reduxjs/toolkit';
import { parseISO } from 'date-fns';
import { useSelector } from 'react-redux';
import { getUserId, getUserRole } from '@/domains/auth/slice';
import { canEditStaff, prepareStaffUpdate } from '@/utils/helpers/get-staff-permission';

import { PageContentHeader } from '@/components/page-content-header';
import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { useGetStaffDetail } from '../../hooks';
import { StaffFormProps, StaffFormSchema } from '../../types';
import {
  Address,
  BasicInformation,
  OtherInformation,
  ParentsInformation,
  staffInitialState
} from '../forms';
import { useUpdateStaffMutation } from '../../api/staff-api';

type StaffAccountEditProps = {
  id?: string;
  redirectPath: string;
  heading: string;
};
type StaffDetailValue<T> = T extends { [key: string]: infer U } ? U : never;

export const StaffAccountEdit: React.FC<StaffAccountEditProps> = ({
  id,
  redirectPath,
  heading
}) => {
  const actorRole = useSelector(getUserRole);
  const actorId = useSelector(getUserId);
  const { currentData: staffDetail, isFetching, error } = useGetStaffDetail(id);
  const [updateStaff, { isLoading: isUpdatingStaff }] = useUpdateStaffMutation();
  const navigate = useNavigate();

  const methods = useForm<StaffFormProps>({
    defaultValues: staffInitialState,
    resolver: zodResolver(StaffFormSchema)
  });

  React.useEffect(() => {
    if (staffDetail) {
      const { setValue } = methods;
      for (const [key, value] of Object.entries(staffDetail) as [
        keyof StaffFormProps,
        StaffDetailValue<StaffFormProps>
      ][]) {
        if (['dob', 'joinDate'].includes(key)) {
          setValue(key, typeof value === 'string' ? parseISO(value) : value);
        } else {
          setValue(key, value);
        }
      }
    }
  }, [staffDetail, methods]);

  const onUpdateStaff = async (data: StaffFormProps) => {
    if (!staffDetail || !canEditStaff(actorRole, staffDetail.role)) return;
    try {
      const result = await updateStaff({
        id: Number(id)!,
        ...prepareStaffUpdate(data, staffDetail, actorRole)
      }).unwrap();
      toast.info(result.message);
      navigate(redirectPath);
    } catch (error) {
      toast.error(getErrorMsg(error as FetchBaseQueryError | SerializedError).message);
    }
  };

  if (isFetching && !staffDetail) return <LinearProgress aria-label='Loading staff' />;
  if (error) return <Alert severity='error'>{getErrorMsg(error).message}</Alert>;
  if (!staffDetail) return <Alert severity='info'>Staff record not found.</Alert>;
  if (!canEditStaff(actorRole, staffDetail.role))
    return <Alert severity='warning'>Only administrators can edit administrator accounts.</Alert>;

  return (
    <>
      <PageContentHeader icon={<Edit sx={{ mr: 1 }} />} heading={heading} />
      <Paper sx={{ p: 3 }}>
        <FormProvider {...methods}>
          <BasicInformation
            identityReadOnly={actorRole !== 'admin'}
            lockRole={actorId === staffDetail.id}
          />

          <hr />
          <Address />

          <hr />
          <ParentsInformation />

          <hr />
          <OtherInformation lockSystemAccess={actorId === staffDetail.id} />
        </FormProvider>
        <hr />
        <Stack alignItems='center' justifyContent='center'>
          <LoadingButton
            loading={isUpdatingStaff}
            size='small'
            variant='contained'
            color='primary'
            onClick={methods.handleSubmit(onUpdateStaff)}
          >
            Save
          </LoadingButton>
        </Stack>
      </Paper>
    </>
  );
};
