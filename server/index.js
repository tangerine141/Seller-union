'use strict';

const config = require('./config');
const { open } = require('./db');
const { createApp } = require('./app');
const { syncAll } = require('./services/sync');

const db = open(config.dbFile);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`${config.siteName} chạy tại ${config.siteUrl} (cổng ${config.port})`);
});

if (config.autoSyncMinutes > 0) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const results = await syncAll(db);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) console.warn(`[auto-sync] ${failed.length}/${results.length} shop lỗi`);
    } finally {
      busy = false;
    }
  }, config.autoSyncMinutes * 60 * 1000).unref();
}
