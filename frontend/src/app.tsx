import * as React from 'react';
import { LinearProgress } from '@mui/material';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';

export const App: React.FC = () => {
  return (
    <React.Suspense fallback={<LinearProgress aria-label='Loading page' />}>
      <RouterProvider router={router} />
    </React.Suspense>
  );
};
