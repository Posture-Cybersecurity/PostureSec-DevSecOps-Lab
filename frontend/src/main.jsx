import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0f1f18',
            color: '#e0ffe8',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '16px',
            fontFamily: 'Space Grotesk, sans-serif',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
