import { Game } from './game/Game';

const branchLabel = __GIT_BRANCH__ && __GIT_BRANCH__ !== 'main' ? ` (${__GIT_BRANCH__})` : '';
document.getElementById('version-tag')!.textContent = `v${__APP_VERSION__}${branchLabel}`;

new Game();
