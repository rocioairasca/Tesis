import { Navigate } from 'react-router-dom';

const RoleProtectedRoute = ({ children, allowedRoles }) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user'));

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />; // Lo manda al dashboard si no tiene permisos
  }

  return children;
};

export default RoleProtectedRoute;
