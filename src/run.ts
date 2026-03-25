import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import { buildOtelEnv } from './otel.js'

export const VALID_PRESETS = [
  'tpcb',
  'tpcc',
  'tpcds',
  'simple',
  'execute_sql'
] as const

export type Preset = (typeof VALID_PRESETS)[number]

export interface RunConfig {
  script: string
  sqlFile: string
  preset: string
  driverUrl: string
  scaleFactor: string
  duration: string
  vus: string
  logLevel: string
  stroppyArgs: string
  k6Args: string
  otel: boolean
}

export interface RunResult {
  exitCode: number
  resultsFile: string
  otelMetricsFile?: string
}

export function buildK6Args(
  k6Args: string,
  resultsFile: string,
  otel: boolean = false
): string[] {
  const args: string[] = [
    '--summary-mode',
    'full',
    '--summary-export',
    resultsFile
  ]

  if (otel) {
    args.push('--out', 'experimental-opentelemetry')
  }

  if (k6Args) {
    args.push(...k6Args.split(/\s+/).filter(Boolean))
  }

  return args
}

export function buildEnv(config: RunConfig): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env,
    DRIVER_URL: config.driverUrl,
    LOG_LEVEL: config.logLevel,
    LOG_MODE: 'development'
  }

  if (config.scaleFactor) {
    env.SCALE_FACTOR = config.scaleFactor
  }
  if (config.duration) {
    env.DURATION = config.duration
  }
  if (config.vus) {
    env.VUS = config.vus
  }
  if (config.otel) {
    Object.assign(env, buildOtelEnv())
  }

  return env
}

export async function runStroppy(config: RunConfig): Promise<RunResult> {
  const resultsFile = path.join(os.tmpdir(), 'stroppy-results.json')
  const k6args = buildK6Args(config.k6Args, resultsFile, config.otel)
  const env = buildEnv(config)

  let exitCode: number

  const stroppyArgs = config.stroppyArgs
    ? config.stroppyArgs.split(/\s+/).filter(Boolean)
    : []

  if (config.script) {
    const args = ['run', config.script]
    if (config.sqlFile) {
      args.push(config.sqlFile)
    }
    args.push(...stroppyArgs)
    if (k6args.length > 0) {
      args.push('--', ...k6args)
    }

    exitCode = await exec.exec('stroppy', args, {
      env,
      ignoreReturnCode: true
    })
  } else {
    const workdir = path.join(os.tmpdir(), 'stroppy-preset')
    await io.mkdirP(workdir)

    await exec.exec(
      'stroppy',
      ['gen', '--workdir', workdir, '--preset', config.preset],
      { env }
    )

    const scriptPath = path.join(workdir, `${config.preset}.ts`)
    const sqlPath = path.join(workdir, `${config.preset}.sql`)

    const args = ['run', scriptPath]
    if (fs.existsSync(sqlPath)) {
      args.push(sqlPath)
    }
    args.push(...stroppyArgs)
    if (k6args.length > 0) {
      args.push('--', ...k6args)
    }

    exitCode = await exec.exec('stroppy', args, {
      env,
      ignoreReturnCode: true
    })
  }

  const resultsExist = fs.existsSync(resultsFile)

  return {
    exitCode,
    resultsFile: resultsExist ? resultsFile : ''
  }
}
