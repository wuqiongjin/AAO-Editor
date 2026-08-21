import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SpriteLocator from './SpriteLocator';
import './sprite-locator.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpriteLocator />
  </StrictMode>,
);
