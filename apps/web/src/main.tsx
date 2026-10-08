import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from './components/Layout';
import { WorkOrderDetailsPage } from './pages/WorkOrderDetailsPage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';
import { store } from './store';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <WorkOrdersPage /> },
      { path: 'work-orders/:id', element: <WorkOrderDetailsPage /> },
      { path: '*', element: <h1>Page not found</h1> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>,
);
