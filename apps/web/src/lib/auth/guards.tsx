import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@vtmp/shared';
import { BootSpinner } from '../../components/BootSpinner';
import { ForbiddenPage } from '../../pages/ForbiddenPage';
import { ROLE_HOME, useAuth } from './context';

/** Signed-in users only; everyone else goes to /login and comes back afterwards. */
export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <BootSpinner />;
  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  // An admin set this password: the user chooses their own first (the API refuses the rest).
  if (user?.mustChangePassword && location.pathname !== CHANGE_PASSWORD) {
    return <Navigate to={CHANGE_PASSWORD} replace />;
  }
  return <Outlet />;
}

const CHANGE_PASSWORD = '/profile/password';

/**
 * UI-side role check. It only decides what to show: the API enforces the same rule on every
 * request (BRQ-1.2), so bypassing this gains nothing.
 */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user) return null;
  return roles.includes(user.role) ? <Outlet /> : <ForbiddenPage />;
}

/** "/" sends each role to its own dashboard. */
export function RoleHomeRedirect() {
  const { user } = useAuth();
  return user ? <Navigate to={ROLE_HOME[user.role]} replace /> : null;
}
