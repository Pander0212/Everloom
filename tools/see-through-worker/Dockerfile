# The See-through layering worker (docs/puppets.md › The layering worker).
#   docker build -t everloom-see-through tools/see-through-worker
#   docker run --gpus all -p 8000:8000 -e WORKER_TOKEN=… everloom-see-through
# The weights download on first start (about 15 GB; mount /root/.cache/huggingface to keep them).
# See-through: Apache-2.0; its weights: CreativeML OpenRAIL++-M (see CREDITS.md).
FROM runpod/pytorch:1.4.0-cu1281-torch280-ubuntu2204
COPY server.py start.sh /opt/worker/
RUN chmod +x /opt/worker/start.sh
EXPOSE 8000
CMD ["/opt/worker/start.sh"]
