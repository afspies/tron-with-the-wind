import http from 'http';
import { Server } from 'colyseus';
import { TronRoom } from './TronRoom';

const port = Number(process.env.PORT) || 2567;

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  }
});

const gameServer = new Server({ server: httpServer });

gameServer.define('tron', TronRoom).filterBy(['roomCode']);

gameServer.listen(port).then(() => {
  console.log(`[Tron Server] Listening on ws://localhost:${port}`);
});
