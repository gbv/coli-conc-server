#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run --allow-net --allow-sys --ext=ts --lock=${COLI_CONC_BASE}/src/deno.lock

/**
 * Script to manage data in jskos-server instances.
 */

/**
 * TODOs:
 * - Support .env files for determining baseUrl (currently not important)
 * - Fix issue with reset requiring confirmation for every single entry
 * - Add filtering
 */

Deno.env.set("FORCE_COLOR", "2")
import { existsSync } from "https://deno.land/std/fs/mod.ts"
import { parseArgs } from "https://deno.land/std@0.207.0/cli/parse_args.ts"
import { $, cd } from "npm:zx@7"

const flags = parseArgs(Deno.args, {
  boolean: ["help", "force", "reset"],
  string: ["d", "t", "s"],
  alias: {
    "help": "h",
    "force": "f",
    "reset": "r",
    "data": "d",
    "target": "t",
    "scheme": "s",
  },
})

const [command, target]: string[] = flags._

const availableCommands = [
  "import",
  "reset",
]

// Determine available targets by reading docker-compose.yml files in service subfolders
import { parse as parseYaml } from "https://deno.land/std@0.207.0/yaml/mod.ts"
import { getEnv } from "../src/utils.ts"
const { servicePath, targetPath, uid, gid, basePath, dataPath, configsPath, secretsPath } = getEnv(target)

if (!flags.data) {
  flags.data = `${configsPath}/vocabularies.txt`
}

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
    -h, --help              Shows this help output
    The following options only apply when running \`data import\` without a service:
    -d, --data <file>       Specify alternative data file
    -f, --force             Force import even if data already exists
    -r, --reset             Reset a vocabulary's concept data before importing
    -t, --target <target>   Filter by target instance
    -s, --scheme <uri>      Filter by scheme URI
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
  // Forward all arguments after target
  const [,, ...args] = Deno.args.slice(Deno.args.findIndex(arg => arg === target) - 1)

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
    await $`docker compose run -it ${runArgs} ${targetService.service} /usr/src/app/bin/${command}.js ${args}`
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
  const shouldProceed = confirm("data import (without target) is not fully implemented yet. Continue anyway?")
  if (!shouldProceed) {
    Deno.exit(0)
  }
  console.log()

  console.log(`Importing vocabularies from ${flags.data} file (target instance: ${flags.target || "all"}, scheme URI: ${flags.scheme || "all"})...`)

  const jskosDataPath = `${dataPath}/jskos-data`

  // TODO: Reset script will currently always ask for confirmation. Using `yes` or `stdin.write` do not work.
  // if (flags.reset && !flags.g) {
  //   const shouldProceed = confirm("Are you sure you want to reset all vocabularies? There will be no further confirmation.")
  //   if (!shouldProceed) {
  //     console.log("Exiting...")
  //     Deno.exit(0)
  //   }
  // }

  const data = (await Deno.readTextFile(flags.data))
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => {
      const lineParts = line.split(/\s+/)
      // Keep original parts
      const [_target, _scheme, ..._conceptPaths] = lineParts
      for (let i = 1; i < lineParts.length; i += 1) {
        if (!lineParts[i].startsWith("/") && !lineParts[i].startsWith("http://") && !lineParts[i].startsWith("https://")) {
          lineParts[i] = `${jskosDataPath}/${lineParts[i]}`
        }
      }
      const [target, scheme, ...conceptPaths] = lineParts
      return {
        _target, 
        _scheme,
        _conceptPaths,
        target,
        scheme,
        conceptPaths,
      }
    }).filter(({ _target, _scheme }) => {
      if (flags.target && _target !== flags.target) {
        return false
      }
      if (flags.scheme && _scheme !== flags.scheme) {
        return false
      }
      return true
    })

  for (let { target, scheme, conceptPaths } of data) {
    console.log(`==================== Importing ${scheme} into ${target} ====================`)
    console.log("Target:", target)
    console.log("Scheme URL/URI:", scheme)
    if (conceptPaths.length) {
      console.log("Concept paths/URLs:")
      conceptPaths.forEach(path => console.log(`- ${path}`))
    }
    console.log("Force:", flags.force)
    console.log("Reset:", flags.reset)
    console.log()
    const targetService = availableTargets.find(t => t.name === target)
    if (!targetService) {
      console.error(`Error: Target with name \`${target}\` does not exist, skipping.\n`)
      continue
    }
    let uri
    if (scheme.startsWith("http://bartoc.org")) {
      uri = scheme
      scheme = `https://bartoc.org/api/data?uri=${uri}`
    }

    try {
      if (flags.reset && uri) {
        await $`data reset ${target} -s ${uri}`
      }
      await $`data import ${target} scheme ${scheme}`

      // Check if concepts exist already
      if (uri && !flags.force && !flags.reset && conceptPaths.length) {
        const baseUrl = await getBaseUrlForTarget(target)
        if (!baseUrl) {
          console.warn(`Warning: Can't check whether concepts for ${uri} in ${target} exist. Importing anyway.`)
        } else {
          const response = await fetch(`${baseUrl}/voc?uri=${encodeURIComponent(uri)}`)
          const json = await response.json()
          if (json?.[0]?.concepts?.length > 0) {
            console.warn(`Concept data for ${uri} already exists. Run script with -f to import anyway.`)
            continue
          }
        }
      }

      for (const path of conceptPaths) {
        await $`data import ${target} concepts ${path}`
      }
    } catch (_error) {
      console.error(`An error occurred with this entry (see above).`)
    }
    console.log()
  }

  if (!data.length) {
    console.log(`No entries found that match given filters.`)
  }
}

async function getBaseUrlForTarget(target: string) {
  // TODO: Support .env files as well
  const possiblePaths = [
    `${configsPath}/${target}.json`,
    `${configsPath}/${target}/config.json`,
    `${configsPath}/${target}/jskos-server.json`,
  ]
  for (const path of possiblePaths) {
    try {
      const config = JSON.parse(await Deno.readTextFile(path))
      let baseUrl = config.baseUrl
      if (!baseUrl) {
        console.error(`getBaseUrlForTarget: Read config file at ${path}, but it does not contain baseUrl`)
        continue
      }
      if (!baseUrl.endsWith("/")) {
        baseUrl += "/"
      }
      return baseUrl
    } catch (_error) {
      // Ignore
    }
  }
  return null
}
