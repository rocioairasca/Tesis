import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import '@ant-design/v5-patch-for-react-19';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

