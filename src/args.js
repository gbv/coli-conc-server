import { basename } from "https://deno.land/std/path/mod.ts"

const flags = {
  help: false,
}
// Type guard function (https://stackoverflow.com/a/69458280)
function isValidFlag(k) {
  return k in flags
}
const commands = ["init", "start", "restart", "stop", "update", "log", "logs", "status", "configtest", "exec", "run"]
let command = "", target = "", argsError = ""
const additionalArgs = []

// Check arguments
for (let arg of Deno.args) {
  if (["exec", "run"].includes(command) && target) {
    additionalArgs.push(arg)
  } else if (arg.startsWith("--")) {
    arg = arg.slice(2)
    if (isValidFlag(arg)) {
      flags[arg] = true
    } else {
      argsError = `Unknown flag --${arg}`
      break
    }
  } else {
    if (!command) {
      if (!commands.includes(arg)) {
        argsError = `Unknown command ${arg}`
        break
      }
      command = arg
    } else if (!target) {
      target = basename(arg)
    } else {
      argsError = `Only one target is supported (given ${target} and ${arg})`
      break
    }
  }
}

// Make sure command and target are given
if (!flags.help && !argsError) {
  if (!command) {
    argsError = "Missing command"
  } else if (!target) {
    argsError = "Missing target"
  }
}

if (argsError) {
  console.error(`Error: ${argsError}\n`)
}
if (flags.help || argsError) {
  console.info(`  Usage: srv <command> <service-name>

  <service-name> is assumed to be a subfolder under \`services/\`
  that contains a Docker Compose or Node.js service.

  Options:
    --help    Shows this help output
  
  Commands:
    init      Initialize a service (installs Node.js dependencies, starts the service, etc.)
    start     Start a service (via Docker Compose or pm2)
    restart   Restart a service (via Docker Compose or pm2)
    update    Updates a service (via Git repo or Docker Compose)
    logs      Shows log output for a service
    exec      Runs \`docker compose exec\` for a specific Docker Compose service
    run       Runs \`docker compose run\` for a specific Docker Compose service
`)
}
if (flags.help) {
  Deno.exit(0)
}
if (argsError) {
  Deno.exit(1)
}

export { flags, command, target, additionalArgs }
