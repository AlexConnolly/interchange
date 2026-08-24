import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
// Not StrictMode in development: it double-invokes effects, which would mount
// two renderers on one canvas and leave a leaked WebGL context behind.
createRoot(root).render(<App />);
export { StrictMode };
