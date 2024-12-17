#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run --allow-sys

/**
 * Script to manage services.
 * 
 * Current assumptions:
 * - Only Docker and Node.js are supported
 * - Docker services are defined through a `docker-compose.yml` file
 * - Node.js services have a `package.json` file with defined dependencies (optionally a lockfile `package-lock.json`)
 *   and also provide a `ecosystem.example.json` example configuration file for pm2.
 */

Deno.env.set("FORCE_COLOR", "2")

import { command, target, additionalArgs } from "../src/args.js"
// We override command in "init"
import { getEnv } from "../src/utils.js"
const { targetPath } = getEnv(target)

import { cd } from "npm:zx@7"
import { exists } from "jsr:@std/fs@1"

import * as webhookHandler from "../src/webhook-handler.js"
import * as dockerCompose from "../src/docker-compose.js"
import * as self from "../src/self.js"
let serviceModule

if (target === webhookHandler.target) {
  serviceModule = webhookHandler
} else if (target === self.target) {
  serviceModule = self
} else if (await exists(`${targetPath}/docker-compose.yml`)) {
  serviceModule = dockerCompose
}

if (!serviceModule) {
  console.error(`Error: Unsupported target in "${target}.`)
  Deno.exit(1)
}

if (serviceModule.target !== webhookHandler.target && serviceModule.target !== self.target) {
  if (!await exists(targetPath)) {
    console.error(`Error: Service "${target}" does not exist.`)
    Deno.exit(1)
  }
  await cd(`${targetPath}`)
}

try {
  // ? Does this work correctly?
  const serviceMethod = serviceModule[command]
  await serviceMethod(target, additionalArgs)
} catch (error) {
  console.error(`Command ${command} for ${target} failed:`)
  console.error(error)
  Deno.exit(1)
}
