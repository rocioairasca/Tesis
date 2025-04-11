import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import AppLayout from './layout/Layout.js';
import Dashboard from './pages/Dashboard.js';
import Users from './pages/Users.js';
import Inventory from './pages/Inventory.js';
import LoginRegister from "./pages/auth/LoginRegister";
import ProtectedRoute from "./routes/ProtectedRoute";
import RoleProtectedRoute from "./routes/RoleProtectedRoute";
import './App.css'; 

function App() {
  return (
    <Router>
      <Routes>
        {/* Rutas públicas (sin layout) */}
        <Route path="/login" element={<LoginRegister />} />

        {/* Rutas privadas (con layout y protegido por token) */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RoleProtectedRoute allowedRoles={[3]}> {/* Solo Admin */}
              <AppLayout>
                <Users />
              </AppLayout>
            </RoleProtectedRoute>
          }
        />
        <Route
          path="/inventario"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Inventory />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* Redirección por defecto */}
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;

