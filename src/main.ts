import { Game } from './game/Game';

document.getElementById('version-tag')!.textContent = `v${__APP_VERSION__}`;

new Game();
