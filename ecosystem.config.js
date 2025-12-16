module.exports = {
  apps: [
    // --- 1. n8n ----------------------------------------------------
    {
      name: "secureflow-n8n",
      script: "n8n",
      env: {
        N8N_HOST: "0.0.0.0",
        N8N_PORT: 5678,
        N8N_PROTOCOL: "http",
        N8N_SECURE_COOKIE: false,
        N8N_LISTEN_ADDRESS: "0.0.0.0",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },

    // --- 2. Backend ------------------------------------------------
    {
      name: "secureflow-backend",
      script: "./server-sqlite.js",
      cwd: "./backend",
      watch: false,            // ❗ 로그 초기화 방지를 위해 watch 끔
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },

    // --- 3. Frontend -----------------------------------------------
    {
      name: "secureflow-frontend",
      script: "npx",
      args: "serve -s build -l 3000",
      cwd: "./frontend",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },
  ],
};
