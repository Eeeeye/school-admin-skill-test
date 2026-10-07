import { useEffect } from 'react';
import { toast } from 'react-toastify';
import { useGetClassesQuery } from '@/domains/class/api';
import { getErrorMsg } from '@/utils/helpers/get-error-message';

export const useClasses = () => {
  const { data, error } = useGetClassesQuery();
  useEffect(() => {
    if (error) toast.error(getErrorMsg(error).message);
  }, [error]);
  return data?.classes ?? [];
};
