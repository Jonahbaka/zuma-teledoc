import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  const htmlPath = path.join(process.cwd(), 'public', 'ng-presentation', 'index.html');
  const html = await readFile(htmlPath, 'utf8');

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, must-revalidate'
    }
  });
}
