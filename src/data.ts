#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-sys --ext=ts --lock=/home/${USER}/src/deno.lock

/**
 * Script to manage data in jskos-server instances.
 */

Deno.env.set("FORCE_COLOR", "2")

const [command, target, ...args] = Deno.args

const availableCommands = [
  "import",
  "reset",
]

// Determine available targets by reading docker-compose.yml files in service subfolders
import { parse as parseYaml } from "https://deno.land/std@0.207.0/yaml/mod.ts"
import { getPaths } from "../src/utils.ts"
const { servicePath } = getPaths(target)

const availableTargets = []

for await (const { name, isDirectory } of Deno.readDir(servicePath)) {
  if (!isDirectory) {
    continue
  }
  try {
    // Try to read docker-compose.yml
    const compose = parseYaml(await Deno.readTextFile(`${servicePath}/${name}/docker-compose.yml`))
    for (const service of Object.keys(compose?.services || {})) {
      if (compose.services[service]?.image?.startsWith("ghcr.io/gbv/jskos-server")) {
        availableTargets.push({
          name,
          service,
        })
        break
      }
    }
  } catch (_) {
    // Just ignore errors as we are expecting them
  }
}

if (["help", "--help"].includes(command)) {
  console.log("Usage: TODO")
  Deno.exit(0)
}

// List all commands for autocompletion
if (command === "list-commands") {
  console.log(availableCommands.join(" "))
  Deno.exit(0)
}

// List all available targets (jskos-server instances) for autocompletion
if (command === "list-targets") {
  console.log(availableTargets.map(t => t.name).join(" "))
  Deno.exit(0)
}

if (!availableCommands.includes(command)) {
  console.error(`Unknown command ${command}.`)
  Deno.exit(1)
}

const targetService = availableTargets.find(t => t.name === target)

if (!targetService) {
  console.error(`Unknown target ${command}.`)
  Deno.exit(1)
}

console.log(`Running ${command} script for ${targetService.name} (Docker service ${targetService.service}) with params ${args}... TODO`)
