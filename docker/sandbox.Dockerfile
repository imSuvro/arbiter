FROM node:22-bookworm-slim

RUN groupadd --gid 10001 arbiter && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin arbiter
WORKDIR /workspace
RUN chown 10001:10001 /workspace
USER 10001:10001

CMD ["node", "--version"]
