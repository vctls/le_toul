# Gunicorn configuration for FastAPI
import os

# Server socket
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
backlog = 2048

# Worker processes
workers = int(os.getenv("WORKER_COUNT", "1"))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000

# Timeout - much longer for development since music separation takes time
is_debug = os.getenv("DEBUG", "False").lower() == "true"
timeout = int(os.getenv("GUNICORN_TIMEOUT", "7200"))  # 2 hours for development
max_requests = int(os.getenv("MAX_REQUESTS", "50"))
reload = is_debug

if is_debug:
    max_requests = 0  # Don't restart workers in development

keepalive = 2
max_requests_jitter = 10

# Logging
accesslog = "-"  # Log to stdout
errorlog = "-"  # Log to stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'
logconfig_dict = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(message)s",
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        },
    },
    "root": {
        "level": "INFO",
        "handlers": ["default"],
    },
    "loggers": {
        "gunicorn.error": {
            "level": "INFO",
            "handlers": ["default"],
            "propagate": False,
        },
    },
}

# Process naming
proc_name = "tuul-api"

# Server mechanics
preload_app = True
daemon = False
pidfile = None
user = None
group = None
tmp_upload_dir = None


def on_starting(server):
    """Fail the jobs a previous server left marked as processing.

    This runs once in the master, before any worker exists. A sweep at app
    startup would run in every worker and could fail a sibling's live job.
    """
    from api.helpers import job_store

    job_store.fail_interrupted_jobs()
