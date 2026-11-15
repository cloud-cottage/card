'use strict';

const tcb = require('@cloudbase/node-sdk');

let _db = null;

function getDb() {
  if (_db) return _db;
  const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE || process.env.CLOUDBASE_ENV_ID;
  const opts = { timeout: 60000 };
  if (env) opts.env = env;
  // 云函数内只传 env：凭据交给运行时注入（不要读取/传递 TENCENTCLOUD_*）
  const app = tcb.init(opts);
  _db = app.database();
  return _db;
}

module.exports = { getDb };
