module.exports = {
  apps: [
    {
      name: 'agents-calc',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=agents-calc-db --local --ip 0.0.0.0 --port 3001',
      env: {
        NODE_ENV: 'development',
        PORT: 3001
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
