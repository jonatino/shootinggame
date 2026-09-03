'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png']
]);

function startStaticServer(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
      const absolute = path.resolve(root, `.${relative}`);
      const insideRoot = absolute === root || absolute.startsWith(`${root}${path.sep}`);
      if (!insideRoot || !fs.statSync(absolute).isFile()) {
        response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': contentTypes.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      fs.createReadStream(absolute).pipe(response);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, {'content-type': 'text/plain; charset=utf-8'});
      response.end(error.code === 'ENOENT' ? 'Not found' : error.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()))
      });
    });
  });
}

module.exports = {startStaticServer};
