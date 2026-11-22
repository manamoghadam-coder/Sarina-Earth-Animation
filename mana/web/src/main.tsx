import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AuthProvider } from './auth';
import { ToastProvider } from './ui';

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></BrowserRouter></StrictMode>);
