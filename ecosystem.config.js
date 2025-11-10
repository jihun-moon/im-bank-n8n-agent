module.exports = {
  apps: [
    // --- 1. n8n ----------------------------------------------------
    {
      name: "imbank-n8n",
      script: "n8n",
      env: {
        N8N_HOST: "0.0.0.0",
        N8N_PORT: 5678,
        N8N_PROTOCOL: "http",
        N8N_SECURE_COOKIE: false,
        N8N_LISTEN_ADDRESS: "0.0.0.0",
      },
    },

    // --- 2. Backend ------------------------------------------------
    {
      name: "imbank-f",
      script: "server.js",
      cwd: "./backend",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },

    // --- 3. Frontend ------------------------------------------------
    {
      name: "imbank-frontend",
      script: "npx",
      args: "serve -s build -l 3000",
      cwd: "./frontend",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

