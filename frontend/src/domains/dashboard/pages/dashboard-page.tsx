import { Button, Grid2, Paper, Stack, Typography } from '@mui/material';
import { useSelector } from 'react-redux';

import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { useGetDashboardDataQuery } from '../api/dashboard-api';
import { Celebrations, GridCard, LeavePolicyDetail, Notices, WhoIsOut } from '../components';
import { getUserRole } from '@/domains/auth/slice';
import { Link } from 'react-router-dom';
import { DashboardProps } from '../types';

export const DashboardPage = () => {
  const currentUserRole = useSelector(getUserRole);
  const { data, isLoading, isError, error } = useGetDashboardDataQuery();

  if (isLoading) {
    return <>loading...</>;
  }
  if (isError) {
    return <>{getErrorMsg(error).message}</>;
  }
  if (!data) {
    return <>No data available</>;
  }

  const { students, teachers, parents, notices, leavePolicies, celebrations, oneMonthLeave } =
    data as DashboardProps;
  return (
    <Grid2 container spacing={4}>
      <Grid2 size={{ xs: 12 }}>
        <Paper variant='outlined' sx={{ p: 3 }}>
          <Typography variant='h5' gutterBottom>
            School workspace
          </Typography>
          <Typography color='text.secondary' sx={{ mb: 2 }}>
            Manage school records and share verifiable student achievements.
          </Typography>
          <Stack direction='row' spacing={1} useFlexGap flexWrap='wrap'>
            {currentUserRole === 'admin' && (
              <Button component={Link} to='/app/students' variant='contained'>
                Students
              </Button>
            )}
            <Button component={Link} to='/app/notices'>
              Notices
            </Button>
            {(currentUserRole === 'admin' || currentUserRole === 'student') && (
              <Button component={Link} to='/app/certificates' variant='outlined'>
                Certificates
              </Button>
            )}
            <Button component={Link} to='/verify'>
              Verify a certificate
            </Button>
          </Stack>
        </Paper>
      </Grid2>
      {currentUserRole === 'admin' && (
        <>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <GridCard {...students} heading='Students admitted this year' />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <GridCard {...teachers} heading='Teachers joined this year' />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <GridCard {...parents} heading='Parents joined this year' />
          </Grid2>
        </>
      )}

      <Grid2 container size={{ xs: 12 }} spacing={3}>
        <Grid2 size={{ xs: 12, md: 4 }}>
          <LeavePolicyDetail leavePolicies={leavePolicies} />
        </Grid2>
        <Grid2 size={{ xs: 12, md: 8 }}>
          <Notices notices={notices} />
        </Grid2>
      </Grid2>

      <Grid2 container size={{ xs: 12 }} spacing={3}>
        <Grid2 size={{ xs: 12, md: 6 }}>
          <Celebrations celebrations={celebrations} />
        </Grid2>
        <Grid2 size={{ xs: 12, md: 6 }}>
          <WhoIsOut whoIsOut={oneMonthLeave} />
        </Grid2>
      </Grid2>
    </Grid2>
  );
};
