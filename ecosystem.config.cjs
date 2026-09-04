/**
 * PM2 process tree: Next.js HTTP server + BullMQ worker.
 *
 * Docker / Hostinger / Coolify PID 1 must be `pm2-runtime` (not `pm2 start`,
 * which daemonizes and exits). Local: `next dev` plus `npm run worker`,
 * or `pm2 start ecosystem.config.cjs --only wacrm-worker`.
 *
 * Fork mode, one instance each. Scale the worker with BullMQ concurrency,
 * not PM2 cluster.
 */

const isProd = process.env.NODE_ENV === 'production'

/** @type {import('pm2').StartOptions[]} */
const apps = [
  {
    name: 'wacrm',
    script: isProd ? 'server.js' : 'node_modules/next/dist/bin/next',
    cwd: process.cwd(),
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 30000,
    max_memory_restart: '512M',
    autorestart: true,
  },
  {
    name: 'wacrm-worker',
    script: isProd ? 'dist/worker.js' : 'node_modules/tsx/dist/cli.mjs',
    cwd: process.cwd(),
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 30000,
    max_memory_restart: '512M',
    autorestart: true,
  },
]

if (!isProd) {
  apps[0].args = 'start'
  apps[1].args = 'src/worker.ts'
}

module.exports = { apps }
