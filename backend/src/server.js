// backend/src/server.js
//
// The only responsibility of this module is to start listening, using the
// loopback-only configuration from config.js. The HTTP application itself lives
// in app.js so it can be exercised by tests without binding a socket.

import { app } from "./app.js";
import { host, port } from "./config.js";
import { getDb } from "./db.js";

// Initialize the SQLite database (schema + migration + idempotent seed) before
// the server starts listening. No API is added by this call.
getDb();

const server = app.listen(port, host, () => {
  console.log(`careband-backend listening on http://${host}:${port}`);
});

export default server;
