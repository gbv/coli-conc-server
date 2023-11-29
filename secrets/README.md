# `secrets` Subfolder

This folder contains files and folders with sensitive information that should not be pushed into the Git repository. They are usually used via a bind mount or `env_file` in a Docker Compose service.

**Note: Make sure to include all sensitive information here instead of committing them into the repository! All files in this folder except this README will be ignored via `.gitignore`.**
