import { useEffect } from 'react';
import { toast } from 'react-toastify';
import { useGetStaffsQuery } from '../api/staff-api';
import { getErrorMsg } from '@/utils/helpers/get-error-message';

export const useGetStaffs = () => {
  const { data, error } = useGetStaffsQuery({});
  useEffect(() => {
    if (error) toast.error(getErrorMsg(error).message);
  }, [error]);
  return data?.staffs ?? [];
};
