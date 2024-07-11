# Data Subfolder

This folder contains persistent data from containers, such as database files from a MongoDB container. In general, it should **not contain configuration files**. Please save configuration files into [`secrets/`](../secrets/README.md).

This folder is exposed as environment variable `$DATA` for Docker Compose files. Usage example:

```yml
services:
  mongo:
    image: mongo:7
    volumes:
      - $DATA/mongo:/data/db
    restart: unless-stopped
```
