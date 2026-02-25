import { Game } from './game/Game';

const envLabel = __APP_ENV__ === 'staging' ? ' (staging)' : '';
document.getElementById('version-tag')!.textContent = `v${__APP_VERSION__}${envLabel}`;

new Game();
