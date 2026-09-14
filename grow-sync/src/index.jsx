import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { ConfigProvider } from 'antd';
import { appTheme } from './theme/theme';
import { cssVariables } from './theme/tokens';
import './layout/shell.css';
import '@ant-design/v5-patch-for-react-19';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
Object.entries(cssVariables).forEach(([name,value])=>document.documentElement.style.setProperty(name,value));
root.render(
  <React.StrictMode>
    <ConfigProvider theme={appTheme}><App /></ConfigProvider>
  </React.StrictMode>
);

