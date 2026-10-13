/**
 * Hooks to be called by other parts of the application.
 * 
 * Supports service deployments and configuration updates.
 */

import { $ } from "npm:zx@8"
import { deployBartocSearch } from "../src/bartoc-search-deploy.js"

const bartocSearchDev = {
  appService: "bartoc-search-dev",
  solrService: "solr-dev",
  image: "ghcr.io/gbv/bartoc-search:dev",
  solrData: "solr_data_dev",
}

/** Return true when a service has its own init or update flow. */
export async function serviceDeploy({ service }) {
  if (service === bartocSearchDev.appService) {
    await deployBartocSearch(bartocSearchDev)
    return true
  }
  return false
}

/** Apply service-specific tasks after a configuration change. */
// deno-lint-ignore no-unused-vars
export async function configUpdate({ service, updatedFiles }) {
  /**
   * Please add at most one if statement for each service
   * and `return` after tasks are done.
   * 
   * If you need to change directories in the code, you **have** to
   * change it back after tasks are done before `return`ing.
   */

  if (service === "cocoda") {
    // Make sure changes in Cocoda configuration are reflected by calling cocoda-version's setup
    await $`srv exec cocoda cocoda bash setup.sh`
    return
  }
  console.log(`- No configUpdate hook for service ${service}.`)
}
