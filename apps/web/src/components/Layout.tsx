import { Link, Outlet } from 'react-router';
import { Toasts } from './Toasts';

export function Layout() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="container app-header-inner">
          <Link to="/" className="brand">
            DispatchPulse
          </Link>
          <span className="tagline">Field service dispatch</span>
        </div>
      </header>
      <main id="main" className="container">
        <Outlet />
      </main>
      <Toasts />
    </>
  );
}
