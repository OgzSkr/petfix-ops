#!/usr/bin/env node
'use strict';

import { createBenimposClient, readBenimposConfig } from '../lib/benimpos/client.js';

async function main() {
  const cfg = await readBenimposConfig();
  const client = createBenimposClient(cfg);
  const health = await client.healthCheck();
  console.log(JSON.stringify(health, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
