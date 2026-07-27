# gthread, not the default sync worker: nearly every slow request here is
# blocked on network I/O (the Pollinations image call), so threads let one
# worker keep serving while another request waits. Sync workers would let a
# handful of image generations stall the whole site.
#
# --timeout 120 because an image generation legitimately takes longer than
# gunicorn's 30s default, and being killed mid-generation looks like a crash.
#
# --chdir backend so printly_backend.py's relative FRONTEND_DIR still
# resolves, exactly as it does when run directly.
web: gunicorn --chdir backend printly_backend:app --worker-class gthread --workers 2 --threads 8 --timeout 120 --graceful-timeout 30 --bind 0.0.0.0:$PORT --access-logfile - --error-logfile -
