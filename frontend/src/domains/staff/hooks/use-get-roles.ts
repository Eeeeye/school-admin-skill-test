import { useEffect } from 'react';
import { toast } from 'react-toastify';
import { useGetRolesQuery } from '@/domains/role-and-permission/api';
import { getErrorMsg } from '@/utils/helpers/get-error-message';

export const useGetRoles = (skip = false) => {
  const { data, error } = useGetRolesQuery(undefined, { skip });
  useEffect(() => {
    if (error) toast.error(getErrorMsg(error).message);
  }, [error]);
  return data?.roles ?? [];
};
