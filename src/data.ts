#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-sys --ext=ts --lock=${COLI_CONC_BASE}/src/deno.lock

/**
 * Script to manage data in jskos-server instances.
 */

Deno.env.set("FORCE_COLOR", "2")
import { existsSync } from "https://deno.land/std/fs/mod.ts"
import { parseArgs } from "https://deno.land/std@0.207.0/cli/parse_args.ts"
import { $, cd } from "npm:zx@7"

const flags = parseArgs(Deno.args, {
  boolean: ["help", "force", "reset"],
  string: ["d"],
  alias: {
    "help": "h",
    "force": "f",
    "reset": "r",
    "data": "d",
  },
  default: {
    "data": "atasda",
  },
})

const [command, target, ...args]: string[] = flags._

const availableCommands = [
  "import",
  "reset",
]

// Determine available targets by reading docker-compose.yml files in service subfolders
import { parse as parseYaml } from "https://deno.land/std@0.207.0/yaml/mod.ts"
import { getEnv } from "../src/utils.ts"
const { servicePath, targetPath, uid, gid, basePath, dataPath, configsPath, secretsPath } = getEnv(target)

// Set environment for `docker compose` calls
import process from "node:process"
process.env.UID = uid
process.env.GID = gid
process.env.HOME = basePath
process.env.DATA = dataPath
process.env.CONFIGS = configsPath
process.env.SECRETS = secretsPath

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

if (flags.help) {
  console.info(`  Usage: data <command> [<service> <arguments for jskos-server import script>]

  <service> is assumed to be a subfolder under \`services/\`
  that contains a JSKOS Server instance.

  If no service is specified, vocabularies in config/vocabularies.txt will be imported.

  Commands:
    import    Runs the import script
    reset     Runs the reset script; requires <service> parameter

  Options:
    -h, --help        Shows this help output
    The following options only apply when running \`data import\` without a service:
    -d, --data <file> Specify alternative data file
    -f, --force       Force import even if data already exists
    -r, --reset       Reset a vocabulary's concept data before importing
    -g <filter>       A grep filter used on vocabularies.txt
`)
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

if (targetService) {
  // ##### Run import/reset script for a particular instance of JSKOS Server #####
  console.log(`Running ${command} script for ${targetService.name} (Docker service ${targetService.service}) with params:`)
  args.forEach(arg => console.log(`    ${arg}`))
  
  // Determine if we are importing a file that needs to be mounted into the target Docker container
  const uuid = crypto.randomUUID()
  const runArgs = []
  if (command === "import" && existsSync(args[args.length - 1])) {
    const index = args.length - 1, file = args[index]
    const ext = file.match(/^.*(\.[^\/]*)$/)?.[1] || ""
    // Use random ID and index to create unique guest filename (in case multiple imports are run simulaneously)
    const guestfile = `/imports/${uuid}-${index}${ext}`
    // Use guest file as argument
    args[index] = guestfile
    runArgs.push("-v")
    runArgs.push(`${Deno.realPathSync(file)}:${guestfile}`)
  }
  
  await cd(targetPath)
  try {
    await $`docker compose run ${runArgs} ${targetService.service} /usr/src/app/bin/${command}.js ${args}`
  } catch (error) {
    console.error()
    console.error(`An error occurred during import attempt. Details should be in the output above. (exit code: ${error.exitCode})`)
  }
} else if (target) {
  console.error(`Error: Unknown target \`${target}\`.`)
  Deno.exit(1)
} else if (command !== "import") {
  console.error(`Error: Command \`${command}\` requires a target.`)
  Deno.exit(1)
} else {
  // ##### Run import script that uses config/vocabularies.txt as data basis #####
  console.warn("Warning: data import (without service) is not yet implemented.")
  Deno.exit(0)
}
