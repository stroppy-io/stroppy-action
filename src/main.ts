import * as core from '@actions/core'
import { installStroppy } from './install.js'
import { runStroppy, VALID_PRESETS } from './run.js'
import type { RunConfig } from './run.js'
import { collectResults } from './results.js'

export async function run(): Promise<void> {
  try {
    const version = core.getInput('version')
    const script = core.getInput('script')
    const sqlFile = core.getInput('sql-file')
    const preset = core.getInput('preset')
    const driverUrl = core.getInput('driver-url', { required: true })
    const scaleFactor = core.getInput('scale-factor')
    const duration = core.getInput('duration')
    const vusScale = core.getInput('vus-scale')
    const poolSize = core.getInput('pool-size')
    const logLevel = core.getInput('log-level')
    const k6Args = core.getInput('k6-args')
    const artifactName = core.getInput('artifact-name')

    if (!script && !preset) {
      throw new Error('Either "script" or "preset" input must be provided')
    }
    if (script && preset) {
      throw new Error('"script" and "preset" are mutually exclusive')
    }
    if (
      preset &&
      !VALID_PRESETS.includes(preset as (typeof VALID_PRESETS)[number])
    ) {
      throw new Error(
        `Invalid preset "${preset}". Valid presets: ${VALID_PRESETS.join(', ')}`
      )
    }

    const resolvedVersion = await core.group('Install stroppy', () =>
      installStroppy(version)
    )

    const config: RunConfig = {
      script,
      sqlFile,
      preset,
      driverUrl,
      scaleFactor,
      duration,
      vusScale,
      poolSize,
      logLevel,
      k6Args
    }

    const result = await core.group('Run benchmark', () => runStroppy(config))

    await core.group('Collect results', () =>
      collectResults(config, result, artifactName, resolvedVersion)
    )

    if (result.exitCode !== 0) {
      core.setFailed(`Benchmark exited with code ${result.exitCode}`)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
