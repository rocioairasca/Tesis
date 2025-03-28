import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import AppLayout from './layout/Layout.js';
import Dashboard from './pages/Dashboard.js';
import Users from './pages/Users.js';
import Inventory from './pages/Inventory.js';
import './App.css'; 

function App() {
  return (
     <Router>
      <AppLayout>
        <Routes>
          <Route exact path="/" element={<Dashboard/>} />
          <Route path="/usuarios" element={<Users/>} />
          <Route path="/inventario" element={<Inventory/>} />
        </Routes>
      </AppLayout>
    </Router>
  );
}

export default App;
