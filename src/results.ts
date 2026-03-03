import * as path from 'node:path'
import * as core from '@actions/core'
import { DefaultArtifactClient } from '@actions/artifact'
import type { RunResult } from './run.js'

export async function collectResults(
  runResult: RunResult,
  artifactName: string
): Promise<void> {
  core.setOutput('exit-code', runResult.exitCode.toString())

  if (!runResult.resultsFile) {
    core.warning('No results file was produced')
    return
  }

  core.setOutput('results-file', runResult.resultsFile)

  try {
    const client = new DefaultArtifactClient()
    const { id } = await client.uploadArtifact(
      artifactName,
      [runResult.resultsFile],
      path.dirname(runResult.resultsFile)
    )
    if (id) {
      core.setOutput('artifact-id', id.toString())
      core.notice(`Artifact "${artifactName}" uploaded (id: ${id})`)
    }
  } catch (err) {
    core.warning(
      `Failed to upload artifact: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
