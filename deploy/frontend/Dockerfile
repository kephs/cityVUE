FROM ghcr.io/nginx/nginx-unprivileged:1.30.5-trixie@sha256:d715f7a85cdfea820fec743ea5aee8a22f91e00ff310ad6275d2638112d8cf8d
# Artifacts are built outside this runtime image using the approved Vite build.
COPY --chown=101:101 dist-react/ /usr/share/nginx/html/
COPY --chown=101:101 deploy/frontend/nginx/nginx.conf /etc/nginx/nginx.conf
USER 101:101
EXPOSE 8080
# No entrypoint templating or writable /etc requirement.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
