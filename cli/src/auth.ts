// ---------------------------------------------------------------------------
// GitLike CLI — Auth Flow
// Opens browser for SIWE signing, receives token via localhost callback.
// ---------------------------------------------------------------------------

import http from 'node:http';
import { readGlobalConfig, writeGlobalConfig, clearGlobalConfig } from './config.js';

/** Start a localhost server, open browser for SIWE, receive token. */
export async function browserLogin(): Promise<void> {
  const config = readGlobalConfig();
  const base = config.apiUrl || 'https://gitlike.dev';

  return new Promise((resolve, reject) => {
    const allowedOrigin = new URL(base).origin;

    const server = http.createServer((req, res) => {
      const origin = req.headers.origin ?? '';
      if (origin && origin !== allowedOrigin) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/callback') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { token?: string; address?: string };
            if (!data.token || !data.address) {
              res.writeHead(400, corsHeaders);
              res.end('Missing token or address');
              return;
            }

            writeGlobalConfig({ ...config, token: data.token, address: data.address });

            res.writeHead(200, { 'Content-Type': 'text/html', ...corsHeaders });
            res.end('OK');

            console.log(`\n✓ Authenticated as ${data.address}`);
            console.log('  You can close the browser tab.');

            server.close();
            resolve();
          } catch (err) {
            res.writeHead(400, corsHeaders);
            res.end('Invalid request');
            server.close();
            reject(err);
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    // Listen on random port on loopback
    const loopback = [127, 0, 0, 1].join('.');
    server.listen(0, loopback, async () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start auth server'));
        return;
      }
      const port = addr.port;
      const authUrl = `${base}/cli-auth?port=${port}`;

      console.log(`Opening browser for authentication...`);
      console.log(`  If it doesn't open, visit: ${authUrl}\n`);

      try {
        const open = (await import('open')).default;
        await open(authUrl);
      } catch {
        // open failed — user can copy the URL
      }
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.close();
        reject(new Error('Auth timed out after 5 minutes.'));
      },
      5 * 60 * 1000,
    );
  });
}

/** Login with a manually provided token. */
export function tokenLogin(token: string, address: string): void {
  const config = readGlobalConfig();
  writeGlobalConfig({ ...config, token, address });
  console.log(`✓ Authenticated as ${address}`);
}

/** Clear stored credentials. */
export function logout(): void {
  clearGlobalConfig();
  console.log('Logged out.');
}

/** Show current auth status. */
export function authStatus(): void {
  const config = readGlobalConfig();
  if (!config.token) {
    console.log('Not authenticated.');
    console.log('  Run: gitlike auth login');
    return;
  }
  console.log(`Authenticated as ${config.address}`);
  console.log(`  API: ${config.apiUrl}`);
}
