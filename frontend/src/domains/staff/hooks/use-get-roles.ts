import { useEffect } from 'react';
import { toast } from 'react-toastify';
import { useGetRolesQuery } from '@/domains/role-and-permission/api';
import { getErrorMsg } from '@/utils/helpers/get-error-message';

export const useGetRoles = () => {
  const { data, error } = useGetRolesQuery();
  useEffect(() => {
    if (error) toast.error(getErrorMsg(error).message);
  }, [error]);
  return data?.roles ?? [];
};
