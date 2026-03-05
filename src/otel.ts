import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'

const OTEL_TOOL = 'otelcol-contrib'
const OTEL_VERSION = '0.147.0'
const OTEL_RELEASES = 'open-telemetry/opentelemetry-collector-releases'

export const OTEL_PORT = 4318

export function buildOtelConfig(metricsFile: string): string {
  return `receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:${OTEL_PORT}

exporters:
  file/metrics:
    path: ${metricsFile}
    format: json

service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file/metrics]
`
}

export function buildOtelEnv(): Record<string, string> {
  return {
    K6_OTEL_EXPORTER_TYPE: 'http',
    K6_OTEL_HTTP_EXPORTER_INSECURE: 'true',
    K6_OTEL_HTTP_EXPORTER_ENDPOINT: `localhost:${OTEL_PORT}`,
    K6_OTEL_HTTP_EXPORTER_URL_PATH: '/v1/metrics',
    K6_OTEL_METRIC_PREFIX: 'k6_',
    K6_OTEL_SERVICE_NAME: 'stroppy'
  }
}

export interface OtelDataPoint {
  timeUnixNano: string
  value?: number
  sum?: number
  count?: number
  min?: number
  max?: number
}

export interface OtelMetric {
  name: string
  type: 'gauge' | 'sum' | 'histogram'
  dataPoints: OtelDataPoint[]
}

interface RawDataPoint {
  timeUnixNano?: string
  asDouble?: number
  asInt?: string
  sum?: number
  count?: string | number
  min?: number
  max?: number
}

interface RawMetric {
  name?: string
  gauge?: { dataPoints?: RawDataPoint[] }
  sum?: { dataPoints?: RawDataPoint[] }
  histogram?: { dataPoints?: RawDataPoint[] }
}

interface RawResourceMetrics {
  resourceMetrics?: Array<{
    scopeMetrics?: Array<{
      metrics?: RawMetric[]
    }>
  }>
}

export function parseOtelMetrics(filePath: string): OtelMetric[] {
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf-8').trim()
  if (!content) return []

  const metricsMap = new Map<string, OtelMetric>()

  for (const line of content.split('\n')) {
    if (!line.trim()) continue

    let parsed: RawResourceMetrics
    try {
      parsed = JSON.parse(line) as RawResourceMetrics
    } catch {
      continue
    }

    for (const rm of parsed.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const m of sm.metrics ?? []) {
          if (!m.name) continue
          processMetric(m, metricsMap)
        }
      }
    }
  }

  return Array.from(metricsMap.values())
}

function processMetric(
  m: RawMetric,
  metricsMap: Map<string, OtelMetric>
): void {
  const name = m.name!

  if (m.gauge?.dataPoints) {
    const existing = getOrCreate(metricsMap, name, 'gauge')
    for (const dp of m.gauge.dataPoints) {
      existing.dataPoints.push({
        timeUnixNano: dp.timeUnixNano ?? '0',
        value: dp.asDouble ?? Number(dp.asInt ?? 0)
      })
    }
  } else if (m.sum?.dataPoints) {
    const existing = getOrCreate(metricsMap, name, 'sum')
    for (const dp of m.sum.dataPoints) {
      existing.dataPoints.push({
        timeUnixNano: dp.timeUnixNano ?? '0',
        value: dp.asDouble ?? Number(dp.asInt ?? 0)
      })
    }
  } else if (m.histogram?.dataPoints) {
    const existing = getOrCreate(metricsMap, name, 'histogram')
    for (const dp of m.histogram.dataPoints) {
      existing.dataPoints.push({
        timeUnixNano: dp.timeUnixNano ?? '0',
        sum: dp.sum,
        count: Number(dp.count ?? 0),
        min: dp.min,
        max: dp.max
      })
    }
  }
}

function getOrCreate(
  map: Map<string, OtelMetric>,
  name: string,
  type: OtelMetric['type']
): OtelMetric {
  let metric = map.get(name)
  if (!metric) {
    metric = { name, type, dataPoints: [] }
    map.set(name, metric)
  }
  return metric
}

export interface OtelSession {
  configPath: string
  metricsFile: string
}

export async function startOtelCol(metricsFile: string): Promise<OtelSession> {
  const configPath = path.join(os.tmpdir(), 'otel-config.yaml')
  const config = buildOtelConfig(metricsFile)
  fs.writeFileSync(configPath, config)

  core.info('Starting otelcol-contrib in background')

  const child = spawn('otelcol-contrib', ['--config', configPath], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  // Wait briefly for the process to start
  await new Promise((resolve) => setTimeout(resolve, 500))

  return { configPath, metricsFile }
}

export async function stopOtelCol(): Promise<void> {
  core.info('Stopping otelcol-contrib')
  await exec.exec('pkill', ['-f', 'otelcol-contrib'], {
    ignoreReturnCode: true
  })
}

export function buildMermaidChart(
  title: string,
  labels: string[],
  values: number[],
  yLabel?: string
): string {
  if (labels.length === 0) return ''

  const xItems = labels.map((l) => `"${l}"`).join(', ')
  const yItems = values.map((v) => v.toFixed(1)).join(', ')
  const yAxis = yLabel ? `  y-axis "${yLabel}"` : '  y-axis "value"'

  return [
    '```mermaid',
    'xychart-beta',
    `  title "${title}"`,
    `  x-axis [${xItems}]`,
    yAxis,
    `  line [${yItems}]`,
    '```\n'
  ].join('\n')
}

export async function installOtelCol(): Promise<void> {
  const semver = OTEL_VERSION

  core.info(`Installing ${OTEL_TOOL} ${semver}`)

  let cachedDir = tc.find(OTEL_TOOL, semver)

  if (cachedDir) {
    core.info(`Found ${OTEL_TOOL} ${semver} in tool cache`)
  } else {
    const url = `https://github.com/${OTEL_RELEASES}/releases/download/v${semver}/otelcol-contrib_${semver}_linux_amd64.tar.gz`
    core.info(`Downloading otelcol-contrib from ${url}`)

    const downloadPath = await tc.downloadTool(url)
    const extractedDir = await tc.extractTar(downloadPath)
    cachedDir = await tc.cacheDir(extractedDir, OTEL_TOOL, semver)
  }

  core.addPath(cachedDir)
}
