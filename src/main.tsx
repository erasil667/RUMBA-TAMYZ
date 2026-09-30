import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import './ui/base.css';
import './ui/styles.css';
import './ui/fixes.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
