import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerPwaServiceWorker } from './services/pwaService';

registerPwaServiceWorker();

createRoot(document.getElementById('root')!).render(<App />);
