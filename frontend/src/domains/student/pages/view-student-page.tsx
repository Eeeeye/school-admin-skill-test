import * as React from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { getUserRole } from '@/domains/auth/slice';
import { useDeleteStudentMutation } from '../api/student-api';
import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { toast } from 'react-toastify';

import { TabPanel } from '@/components/tab-panel';
import { PageContentHeader } from '@/components/page-content-header';
import { StudentProfile } from '@/components/user-account-profile';

const tabs = ['Profile'];
export const ViewStudent = () => {
  const { id } = useParams();
  const role = useSelector(getUserRole);
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteStudent, deletion] = useDeleteStudentMutation();
  const removeStudent = async () => {
    try {
      await deleteStudent(Number(id)).unwrap();
      toast.success('Student deleted.');
      navigate('/app/students');
    } catch {
      /* The dialog displays the API error. */
    }
  };
  const [tab, setTab] = React.useState(0);

  React.useEffect(() => {
    setTab(0);
  }, []);

  const handleTabChange = (_event: React.SyntheticEvent, index: number) => {
    setTab(index);
  };

  return (
    <>
      <Stack direction='row' spacing={1} useFlexGap flexWrap='wrap' sx={{ mb: 2 }}>
        <Button component={Link} to='/app/students'>
          All students
        </Button>
        {role === 'admin' && (
          <>
            <Button component={Link} to={`/app/students/edit/${id}`} variant='outlined'>
              Edit student
            </Button>
            <Button component={Link} to={`/app/certificates?studentId=${id}`} variant='contained'>
              Student certificates
            </Button>
            <Button color='error' onClick={() => setDeleteOpen(true)}>
              Delete student
            </Button>
          </>
        )}
      </Stack>
      <PageContentHeader heading='Account Details' />
      <Box component={Paper} sx={{ p: 1 }}>
        <Tabs
          variant='scrollable'
          value={tab}
          onChange={handleTabChange}
          sx={{ borderRight: 1, borderColor: 'divider' }}
        >
          {tabs.map((tab) => (
            <Tab key={tab} label={tab} />
          ))}
        </Tabs>
        <Box sx={{ display: 'flex', flexGrow: 1 }}>
          <TabPanel value={tab} index={0}>
            <StudentProfile id={id} />
          </TabPanel>
        </Box>
      </Box>
      <Dialog
        open={deleteOpen}
        onClose={deletion.isLoading ? undefined : () => setDeleteOpen(false)}
        fullWidth
        maxWidth='sm'
      >
        <DialogTitle>Delete this student?</DialogTitle>
        <DialogContent>
          <Typography>
            The student account, profile and associated leave records will be permanently removed.
            Issued blockchain records cannot be erased. Revoke any certificates that should no
            longer be valid before deleting the student.
          </Typography>
          {deletion.error && (
            <Alert severity='error' sx={{ mt: 2 }}>
              {getErrorMsg(deletion.error).message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={deletion.isLoading} onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            color='error'
            variant='contained'
            disabled={deletion.isLoading}
            onClick={removeStudent}
          >
            {deletion.isLoading ? 'Deleting…' : 'Delete student'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
