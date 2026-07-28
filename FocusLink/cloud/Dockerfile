FROM node:20-alpine
LABEL org.opencontainers.image.title="FocusLink retired Node authority"
LABEL org.opencontainers.image.description="Production authority moved to the private Account Durable Object"
WORKDIR /app
USER node
CMD ["node", "-e", "console.error('retired: Account Durable Object is the only FocusLink production authority'); process.exit(78)"]
