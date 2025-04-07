import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import AppLayout from './layout/Layout.js';
import Dashboard from './pages/Dashboard.js';
import Users from './pages/Users.js';
import Inventory from './pages/Inventory.js';
import LoginRegister from "./pages/auth/LoginRegister";
import './App.css'; 

function App() {
  return (
     <Router>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/login" />} />
          <Route path="/login" element={<LoginRegister />} /> 
          <Route exact path="/dashboard" element={<Dashboard/>} />
          <Route path="/usuarios" element={<Users/>} />
          <Route path="/inventario" element={<Inventory/>} />
        </Routes>
      </AppLayout>
    </Router>
  );
}

export default App;
