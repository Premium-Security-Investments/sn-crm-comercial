import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../../agt002-hetzner-bridge-server.js';

export async function startSyntheticAgt002HetznerBridge({ hmacSecret, codexClient }) {
  const server = createServer(createAgt002BridgeServer({ hmacSecret, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1/agt002-preview/run`,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}
