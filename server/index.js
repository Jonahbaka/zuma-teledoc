/**
 * MINIMAL Cloud Run Server
 * Just binds to port - nothing else
 */

const http = require('http');
const PORT = parseInt(process.env.PORT, 10) || 8080;

// Create the simplest possible server
const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <!DOCTYPE html>
    <html>
    <head><title>Docta. - Starting</title></head>
    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
      <div style="text-align: center;">
        <h1>🚀 Docta. Server Running</h1>
        <p>Port: ${PORT}</p>
        <p>Time: ${new Date().toISOString()}</p>
      </div>
    </body>
    </html>
  `);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`SERVER LISTENING ON 0.0.0.0:${PORT}`);
  console.log(`TIME: ${new Date().toISOString()}`);
  console.log('========================================');
});
