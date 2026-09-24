import { defineRailway, project, service, volume } from "railway/iac";

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
    env: {
      DEBUG: "False",
      // A recycled worker takes its background separation with it.
      MAX_REQUESTS: "0",
      WORKER_COUNT: "1",
      LOCAL_JOB_DIR: "/data/jobs",
      MODELS_DIR: "/data/models",
      LOGGING_FORMAT: "console",
      SEPARATION_BACKEND: "subprocess",
      SEPARATION_OUTPUT_FORMAT: "flac",
      INSTALL_SEPARATION: "true",
      // Torch sizes its thread pools from nproc, which reports the host's 48
      // CPUs rather than the 8 of quota. Keep in sync with the plan's vCPU.
      OMP_NUM_THREADS: "8",
      MKL_NUM_THREADS: "8",
    },
  });

  return project("le_toul", {
    resources: [le_toul, data],
  });
});
