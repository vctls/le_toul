import { defineRailway, preserve, project, service, volume } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "le_toul";

export default defineRailway(() => {
  const data = volume("data", { region: "europe-west4-drams3a", sizeMB: 5000 });

  // Serverless must stay off in the dashboard, because IaC cannot express it.
  // A sleeping container kills a separation once the browser tab closes.
  const le_toul = service("le_toul", {
    start: "gunicorn --config gunicorn.conf.py api.main:app",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    // The local job store is per instance, so a second replica 404s on jobs.
    replicas: { "europe-west4-drams3a": 1 },
    volumeMounts: { "/data": data },
    domains: ["le-toul.com"],
    env: {
      DEBUG: "False",
      // A recycled worker takes its background separation with it.
      MAX_REQUESTS: "0",
      WORKER_COUNT: "1",
      LOCAL_JOB_DIR: "/data/jobs",
      LOGGING_FORMAT: "console",
      SEPARATION_BACKEND: "remote",
      SEPARATION_REMOTE_URL: "https://vctls--tuul-separation-web.modal.run",
      // A Modal proxy token, sealed in the dashboard.
      SEPARATION_REMOTE_KEY: preserve(),
      SEPARATION_REMOTE_SECRET: preserve(),
      // Keep equal to MAX_GPU_CONTAINERS in api/modal_app.py.
      SEPARATION_CONCURRENCY: "3",
      INSTALL_SEPARATION: "false",
    },
  });

  return project("le_toul", {
    resources: [le_toul, data],
  });
});
