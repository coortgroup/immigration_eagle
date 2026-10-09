import { createLocalServer } from '../server/local-server.mjs';

const port = Number(process.env.LOCAL_PORT || process.env.PORT || 4177);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LOCAL_PORT must be a port from 1 to 65535.');
const server = createLocalServer();
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set LOCAL_PORT to another port.` : 'Could not start the local server.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Local website: http://127.0.0.1:${port}/immigration_eagle/`);
  console.log(`Local team inbox: http://127.0.0.1:${port}/local-inbox/`);
  console.log('Requests stay in .local/requests.json on this computer. No email or external notification is sent.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeIdleConnections(); });
