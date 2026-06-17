import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Geçersiz JSON gövdesi');
    error.statusCode = 400;
    throw error;
  }
}

export function sendJson(response, data, statusCode = 200) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(data, null, 2));
}

export function sendHtml(response, html, statusCode = 200) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8'
  });
  response.end(html);
}

export async function serveStatic(response, pathname, publicDir = paths.public) {
  const relative = pathname.replace(/^\/assets\//, '');
  const filePath = path.resolve(publicDir, 'assets', relative);
  const assetsRoot = path.resolve(publicDir, 'assets');

  if (!filePath.startsWith(assetsRoot)) {
    return sendJson(response, { error: 'Not found' }, 404);
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(response, { error: 'Not found' }, 404);
    }
    throw error;
  }

  const types = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };
  const ext = path.extname(filePath);

  response.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=300'
  });
  response.end(content);
}
