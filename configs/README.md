# `configs` Subfolder

This folder contains configuration files that can be symlinked to the specific service subfolders or provided to Docker containers via bind volumes.

**Note: Make sure to not include any sensitive information here!**

## Special Files

- `vocabularies.txt` - defined vocabularies for import via `data` script, see [here](../README.md#data-management-for-jskos-server-instances)
- `hooks.js` - allows code to be hooked into certain changes (currently only `configUpdate`, will be extended later if necessary)
