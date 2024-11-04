/**
 * Hooks to be called by other parts of the application.
 * 
 * Currently only supports `configUpdate`.
 */

import { $ } from "npm:zx@7"

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
