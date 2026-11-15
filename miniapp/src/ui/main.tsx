/**
 * WebView entry. MentraProvider calls mentra.ready() once mounted (which
 * hides the host's loading screen) and mirrors the host theme as <html class="dark">.
 */
import { createRoot } from 'react-dom/client';
import { MentraProvider } from '@mentra/miniapp/ui';
import '../shared/channels';
import '@fontsource/caveat/latin-500.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-600.css';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');

createRoot(root).render(
  <MentraProvider>
    <App />
  </MentraProvider>
);
