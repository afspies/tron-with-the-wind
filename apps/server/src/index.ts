import { Server } from 'colyseus';
import { TronRoom } from './TronRoom';

const port = Number(process.env.PORT) || 2567;

const gameServer = new Server();

gameServer.define('tron', TronRoom).filterBy(['roomCode']);

gameServer.listen(port).then(() => {
  console.log(`[Tron Server] Listening on ws://localhost:${port}`);
});
