const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'buybox-platform',
      cwd: __dirname,
      script: 'server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 15,
      restart_delay: 3000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 8787
      },
      error_file: 'logs/platform-error.log',
      out_file: 'logs/platform-out.log',
      log_file: 'logs/platform-combined.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'live-buybox-worker',
      cwd: path.join(__dirname, '..', 'live-buybox-worker'),
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      min_uptime: '10s',
      max_restarts: 20,
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production'
      },
      error_file: path.join(__dirname, 'logs/worker-error.log'),
      out_file: path.join(__dirname, 'logs/worker-out.log'),
      log_file: path.join(__dirname, 'logs/worker-combined.log'),
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
