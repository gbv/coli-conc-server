#!/usr/bin/env -S COLI_CONC_BASE=. deno run --allow-env --allow-read --allow-sys

/**
 * Checks docker-compose.yml files for issues:
 * 
 * - Duplicate service names
 * 
 * Ideas for other issues to check:
 * 
 * - restart directive
 * - Docker networks
 * - volume paths
 */

Deno.env.set("FORCE_COLOR", "2")

// Determine available targets by reading docker-compose.yml files in service subfolders
import { parse as parseYaml } from "jsr:@std/yaml@1"
import { getEnv } from "../src/utils.js"
const { servicePath } = getEnv("")

const serviceNamesToComposeFiles = {}
let ok = true

// Get value from environment array in docker-compose.yml
const envValue = (env, name) => env?.find(e => (new RegExp(`^[\\n\s]*${name}\s*=`).test(e)))?.split(/=\s*/)[1]

// Iterate over every docker-compose.yml
for await (const { name } of Deno.readDir(servicePath)) {
  const file = `${servicePath}/${name}/docker-compose.yml`
  const fileShort = file.replace(servicePath, "")
  try { await Deno.lstat(file) } catch (_) { continue }  
  const errors = []
  const configs = []
  try {
    const compose = parseYaml(await Deno.readTextFile(file))
    for (const service of Object.keys(compose?.services || {})) {        
      if (serviceNamesToComposeFiles[service]) {
        errors.push(`!!! Service "${service}" is already defined in ${serviceNamesToComposeFiles[service]}`)
      } else {
        serviceNamesToComposeFiles[service] = fileShort
      }
      const { image, environment } = compose.services[service]        
      const urls = []
      const hosts = (envValue(environment, 'VIRTUAL_HOST'))?.split(",")
      const path = envValue(environment, 'VIRTUAL_PATH')
      if (hosts && path && !path.startsWith("~")) { // TODO: support pattern path
        for (const host of hosts) {
          urls.push(`http://${host}${path}`)
        }
      } else {
        const multiport = envValue(environment, 'VIRTUAL_HOST_MULTIPORTS')
        if (multiport) {
          for (const [ host, pathes ] of Object.entries(parseYaml(multiport))) {
            for (const path in pathes) {
              urls.push(`http://${host}${path}`)
            }
          }
        }
      }
      const about = {
        service,
        config: `https://github.com/gbv/coli-conc-server/tree/main/services${fileShort}`,
        image,
      }
      configs.push(urls.length ? { ...about, urls } : about)
    }
  } catch (e) {
    errors.push(e)
  }

  if (errors.length) {
    console.error(`%c${fileShort}`, "color: red")
    errors.forEach(error => console.error(`%c  ${error}`, "color: red"))
    ok = false
  } else {
    console.log(`%c${fileShort}`, "color: green")
    configs.forEach(c => console.log(JSON.stringify(c)))
  }
}

if (!ok) {
  Deno.exit(1)
}
