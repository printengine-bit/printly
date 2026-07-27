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
#
# Sized for the Hobby plan's 1GB / 2 vCPU ceiling: 2 workers (one per vCPU)
# x 4 threads. Each worker is a separate Python heap carrying Flask, Pillow
# and requests, so worker count is the expensive dial — threads are nearly
# free and are what actually absorb the I/O wait. Raising either without
# raising the plan's memory limit risks the OOM killer mid-request.
web: gunicorn --chdir backend printly_backend:app --worker-class gthread --workers 2 --threads 4 --timeout 120 --graceful-timeout 30 --max-requests 400 --max-requests-jitter 50 --bind 0.0.0.0:$PORT --access-logfile - --error-logfile -
