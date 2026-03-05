import * as core from '@actions/core'
import { installStroppy } from './install.js'
import { runStroppy, VALID_PRESETS } from './run.js'
import type { RunConfig } from './run.js'
import { collectResults } from './results.js'
import { installOtelCol, startOtelCol, stopOtelCol } from './otel.js'

export async function run(): Promise<void> {
  let otelStarted = false

  try {
    const version = core.getInput('version')
    const script = core.getInput('script')
    const sqlFile = core.getInput('sql-file')
    const preset = core.getInput('preset')
    const driverUrl = core.getInput('driver-url', { required: true })
    const scaleFactor = core.getInput('scale-factor')
    const duration = core.getInput('duration')
    const vus = core.getInput('vus')
    const logLevel = core.getInput('log-level')
    const k6Args = core.getInput('k6-args')
    const artifactName = core.getInput('artifact-name')
    const metricsEnabled = core.getInput('metrics') !== 'false'

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

    if (metricsEnabled) {
      await core.group('Install OpenTelemetry Collector', () =>
        installOtelCol()
      )
      await core.group('Start OpenTelemetry Collector', () =>
        startOtelCol('/tmp/otel-metrics.json')
      )
      otelStarted = true
    }

    const config: RunConfig = {
      script,
      sqlFile,
      preset,
      driverUrl,
      scaleFactor,
      duration,
      vus,
      logLevel,
      k6Args,
      otel: metricsEnabled
    }

    const otelMetricsFile = '/tmp/otel-metrics.json'
    const result = await core.group('Run benchmark', () => runStroppy(config))

    if (otelStarted) {
      await core.group('Stop OpenTelemetry Collector', () => stopOtelCol())
      result.otelMetricsFile = otelMetricsFile
    }

    await core.group('Collect results', () =>
      collectResults(config, result, artifactName, resolvedVersion)
    )

    if (result.exitCode !== 0) {
      core.setFailed(`Benchmark exited with code ${result.exitCode}`)
    }
  } catch (error) {
    if (otelStarted) {
      try {
        await stopOtelCol()
      } catch {
        // best effort
      }
    }
    if (error instanceof Error) core.setFailed(error.message)
  }
}
