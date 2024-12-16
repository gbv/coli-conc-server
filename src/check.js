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
import { parse as parseYaml } from "https://deno.land/std@0.207.0/yaml/mod.ts"
import { getEnv } from "../src/utils.js"
const { servicePath } = getEnv("")

const serviceNamesToComposeFiles = {}
let ok = true

for await (const { name, isDirectory } of Deno.readDir(servicePath)) {
  if (!isDirectory) {
    continue
  }
  try {
    // Try to read docker-compose.yml
    const file = `${servicePath}/${name}/docker-compose.yml`
    const fileShort = file.replace(servicePath, "")
    const compose = parseYaml(await Deno.readTextFile(file))
    const errors = []
    for (const service of Object.keys(compose?.services || {})) {
      if (serviceNamesToComposeFiles[service]) {
        errors.push(`!!! Service "${service}" is already defined in ${serviceNamesToComposeFiles[service]}`)
        ok = false
      } else {
        serviceNamesToComposeFiles[service] = fileShort
      }
    }
    if (errors.length) {
      console.error(`%c${fileShort}`, "color: red")
      errors.forEach(error => console.error(`%c  ${error}`, "color: red"))
    } else {
      console.log(`%c${fileShort}`, "color: green")
      console.log("%c  All good.", "color: green")
    }
  } catch (_) {
    // Just ignore errors as we are expecting them
  }
}

if (!ok) {
  Deno.exit(1)
}
