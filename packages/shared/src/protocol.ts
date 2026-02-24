/** Messages sent from client to server */
export enum ClientMsg {
  Input = 'input',
  Chat = 'chat',
  SetConfig = 'setConfig',
  StartGame = 'startGame',
  PlayAgain = 'playAgain',
}

/** Messages sent from server to client (beyond schema auto-sync) */
export enum ServerMsg {
  Chat = 'chat',
  PowerUpEffect = 'powerupEffect',
}
