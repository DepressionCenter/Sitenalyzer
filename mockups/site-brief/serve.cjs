/*
This file is part of Sitenalyzer
serve.cjs
Author(s): Gabriel Mongefranco.
Created: 2026-10-15
Last Modified: 2026-10-19
Summary: Serves only the synthetic preview and its review artifacts on loopback.
Notes: See README file for documentation and full license information.

Copyright © 2026 The Regents of the University of Michigan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const base = '/mockups/site-brief/';
const root = path.resolve(__dirname, '../..');
const allowed = new Map(['index.html', 'preview.css', 'gallery.css', 'preview.js', 'fixtures.js'].map(name => [base + name, path.join(__dirname, name)]));
allowed.set('/src/lib/xlsx.full.min.js', path.join(root, 'src/lib/xlsx.full.min.js'));
allowed.set('/README.md', path.join(root, 'README.md'));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const port = Number(process.argv[2] || 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Choose a port from 1024 through 65535.');
  process.exit(1);
}
const review = path.join(__dirname, 'review');
if (fs.existsSync(review)) {
  for (const entry of fs.readdirSync(review, { withFileTypes: true })) {
    if (entry.isFile() && Object.hasOwn(types, path.extname(entry.name))) allowed.set(base + 'review/' + entry.name, path.join(review, entry.name));
  }
}

/** Serves a fixed file allowlist. No writes, authentication, remote fetches, or directory listing are supported. */
const server = http.createServer((request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Read-only preview.'); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400); response.end('Invalid address.'); return; }
  if (pathname === '/') { response.writeHead(302, { Location: base + 'index.html' }); response.end(); return; }
  const filename = allowed.get(pathname);
  if (!filename || !fs.existsSync(filename)) { response.writeHead(404); response.end('This file is not part of the preview.'); return; }
  response.setHeader('Content-Type', types[path.extname(filename)] || 'text/plain; charset=utf-8');
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(filename);
  stream.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end('The preview file could not be read. Restart the preview and try again.'); });
  stream.pipe(response);
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'That port is in use. Run this command with a different port number.' : 'The preview server could not start. Check the port and try again.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port + base + 'index.html\nGallery: http://127.0.0.1:' + port + base + 'review/index.html'));
