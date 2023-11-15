# `secrets` Subfolder

This folder contains files and folders with sensitive information that should not be pushed into the Git repository. These can either be used in multiple ways:

- Bind mount into Docker Compose service.
- Used in [service configuration files] in `files` or `env` by setting the value to `secret:FILENAME`.
  - For `env` values, the value will be replaced by the contents of `secrets/FILENAME`.
  - For `files` values, the source path will default to `secrets` folder instead of the `configs` folder.

**Note: Make sure to include all sensitive information here instead of committing them into the repository! All files in this folder except this README will be ignored via `.gitignore`.**

[service configuration files]: ../README.md#service-configuration-file
