import { startApp } from './app';

window.addEventListener('DOMContentLoaded', () => {
  startApp().catch((err) => {
    console.error('Failed to start FlowDeck:', err);
  });
});
