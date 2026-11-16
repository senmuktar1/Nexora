// Local HTTPS stand-in for Horizon, used ONLY by the RWA/admin browser suite so the
// server's on-chain verification can run against the exact transactions the browser
// signed. Fixtures are posted by the test (POST /__fixtures). Nothing touches a network.
//   MOCK_HORIZON_CERT=cert.pem MOCK_HORIZON_KEY=key.pem MOCK_HORIZON_PORT=8443 node e2e/mock-horizon.mjs
import { createServer } from "node:https";
import { readFileSync } from "node:fs";

const fixtures = new Map();
const server = createServer({ cert: readFileSync(process.env.MOCK_HORIZON_CERT), key: readFileSync(process.env.MOCK_HORIZON_KEY) }, (req, res) => {
  if (req.method === "POST" && req.url === "/__fixtures") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      for (const [k, v] of Object.entries(JSON.parse(body || "{}"))) fixtures.set(k, v);
      res.writeHead(204).end();
    });
    return;
  }
  const value = fixtures.get(req.url);
  if (value === undefined) { res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ status: 404 })); return; }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
});
server.listen(Number(process.env.MOCK_HORIZON_PORT ?? 8443), "127.0.0.1", () => console.log("mock horizon ready"));
