import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import { DefaultArtifactClient } from '@actions/artifact'
import type { RunConfig, RunResult } from './run.js'
import { parseOtelMetrics, buildMermaidChart } from './otel.js'
import type { OtelMetric } from './otel.js'

interface MetricValue {
  count?: number
  rate?: number
  value?: number
  min?: number
  max?: number
  avg?: number
  med?: number
  'p(90)'?: number
  'p(95)'?: number
  passes?: number
  fails?: number
}

interface StoppyResults {
  metrics?: Record<string, MetricValue>
}

export async function collectResults(
  config: RunConfig,
  runResult: RunResult,
  artifactName: string,
  version: string
): Promise<void> {
  core.setOutput('exit-code', runResult.exitCode.toString())

  if (!runResult.resultsFile) {
    core.warning('No results file was produced')
  } else {
    core.setOutput('results-file', runResult.resultsFile)
  }

  let artifactId: number | undefined

  if (runResult.resultsFile) {
    try {
      const client = new DefaultArtifactClient()
      const { id } = await client.uploadArtifact(
        artifactName,
        [runResult.resultsFile],
        path.dirname(runResult.resultsFile)
      )
      artifactId = id ?? undefined
      if (artifactId) {
        core.setOutput('artifact-id', artifactId.toString())
      }
    } catch (err) {
      core.warning(
        `Failed to upload artifact: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  await writeSummary(config, runResult, version, artifactId)
}

async function writeSummary(
  config: RunConfig,
  runResult: RunResult,
  version: string,
  artifactId: number | undefined
): Promise<void> {
  const passed = runResult.exitCode === 0
  const statusIcon = passed ? '\u2705' : '\u274C'
  const statusText = passed
    ? 'Passed'
    : `Failed (exit code ${runResult.exitCode})`
  const mode = config.script || config.preset

  core.summary.addHeading('Stroppy Benchmark Results', 2)

  core.summary.addTable([
    [
      { data: 'Parameter', header: true },
      { data: 'Value', header: true }
    ],
    ['Status', `${statusIcon} ${statusText}`],
    ['Mode', config.script ? `Script: ${config.script}` : `Preset: ${mode}`],
    ['Stroppy version', version],
    ['Driver URL', maskUrl(config.driverUrl)],
    ...(config.duration ? [['Duration', config.duration]] : []),
    ...(config.vus ? [['VUs', config.vus]] : []),
    ...(config.scaleFactor ? [['Scale factor', config.scaleFactor]] : [])
  ])

  if (runResult.resultsFile) {
    const data = readResults(runResult.resultsFile)
    if (data?.metrics) {
      writeMetricsTables(data.metrics)
    }
  }

  if (runResult.otelMetricsFile) {
    const otelMetrics = parseOtelMetrics(runResult.otelMetricsFile)
    if (otelMetrics.length > 0) {
      writeOtelCharts(otelMetrics)
    }
  }

  if (artifactId) {
    const runUrl = artifactDownloadUrl()
    core.summary.addSeparator()
    if (runUrl) {
      core.summary.addRaw(
        `<p><a href="${runUrl}"><img src="https://img.shields.io/badge/%F0%9F%93%A6_Download-Results_JSON-blue?style=for-the-badge" alt="Download Results JSON"></a></p>`,
        true
      )
    } else {
      core.summary.addRaw(
        `\uD83D\uDCE6 Results artifact uploaded (id: ${artifactId})`,
        true
      )
    }
  }

  await core.summary.write()
}

function writeMetricsTables(metrics: Record<string, MetricValue>): void {
  const throughput: string[][] = []
  const latency: string[][] = []
  const other: string[][] = []

  for (const [name, m] of Object.entries(metrics)) {
    if (isDuration(m)) {
      latency.push([
        `\`${name}\``,
        fmt(m.avg),
        fmt(m.med),
        fmt(m['p(90)']),
        fmt(m['p(95)']),
        fmt(m.min),
        fmt(m.max)
      ])
    } else if (isCounter(m)) {
      throughput.push([`\`${name}\``, fmtInt(m.count), fmtRate(m.rate)])
    } else if (isRate(m)) {
      const total = (m.passes ?? 0) + (m.fails ?? 0)
      const pct = total > 0 ? ((m.passes ?? 0) / total) * 100 : 0
      other.push([
        `\`${name}\``,
        `${pct.toFixed(1)}%`,
        `${fmtInt(m.passes)} / ${fmtInt(m.fails)}`
      ])
    } else if (isGauge(m)) {
      other.push([
        `\`${name}\``,
        fmt(m.value),
        `${fmt(m.min)} \u2013 ${fmt(m.max)}`
      ])
    }
  }

  if (throughput.length > 0) {
    core.summary.addHeading('Throughput', 3)
    core.summary.addTable([
      [
        { data: 'Metric', header: true },
        { data: 'Count', header: true },
        { data: 'Rate (/s)', header: true }
      ],
      ...throughput
    ])
  }

  if (latency.length > 0) {
    core.summary.addHeading('Latency (ms)', 3)
    core.summary.addTable([
      [
        { data: 'Metric', header: true },
        { data: 'Avg', header: true },
        { data: 'Med', header: true },
        { data: 'p90', header: true },
        { data: 'p95', header: true },
        { data: 'Min', header: true },
        { data: 'Max', header: true }
      ],
      ...latency
    ])
  }

  if (other.length > 0) {
    core.summary.addHeading('Other', 3)
    core.summary.addTable([
      [
        { data: 'Metric', header: true },
        { data: 'Value', header: true },
        { data: 'Details', header: true }
      ],
      ...other
    ])
  }
}

function writeOtelCharts(metrics: OtelMetric[]): void {
  core.summary.addHeading('Time Series', 3)

  for (const metric of metrics) {
    if (metric.dataPoints.length < 2) continue

    const sorted = [...metric.dataPoints].sort((a, b) =>
      a.timeUnixNano.localeCompare(b.timeUnixNano)
    )
    const startNano = BigInt(sorted[0].timeUnixNano)

    const labels = sorted.map((dp) => {
      const offsetSec = Number(
        (BigInt(dp.timeUnixNano) - startNano) / 1000000000n
      )
      const min = Math.floor(offsetSec / 60)
      const sec = offsetSec % 60
      return `${min}:${sec.toString().padStart(2, '0')}`
    })

    const values = sorted.map((dp) => {
      if (metric.type === 'histogram' && dp.count && dp.sum) {
        return dp.sum / dp.count // avg
      }
      return dp.value ?? 0
    })

    const yLabel =
      metric.type === 'histogram' ? 'ms' : metric.type === 'sum' ? 'count' : ''
    const chart = buildMermaidChart(metric.name, labels, values, yLabel)
    if (chart) {
      core.summary.addRaw(chart, true)
    }
  }
}

function isDuration(m: MetricValue): boolean {
  return m.avg !== undefined && m.med !== undefined
}

function isCounter(m: MetricValue): boolean {
  return m.count !== undefined && m.rate !== undefined
}

function isRate(m: MetricValue): boolean {
  return m.passes !== undefined || m.fails !== undefined
}

function isGauge(m: MetricValue): boolean {
  return m.value !== undefined
}

function fmt(v: number | undefined): string {
  if (v === undefined) return '-'
  return Number.isInteger(v) ? v.toString() : v.toFixed(2)
}

function fmtInt(v: number | undefined): string {
  if (v === undefined) return '-'
  return Math.round(v).toLocaleString('en-US')
}

function fmtRate(v: number | undefined): string {
  if (v === undefined) return '-'
  return v.toFixed(2)
}

function artifactDownloadUrl(): string | null {
  const serverUrl = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (!serverUrl || !repo || !runId) return null
  return `${serverUrl}/${repo}/actions/runs/${runId}#artifacts`
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    return '***'
  }
}

function readResults(filePath: string): StoppyResults | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as StoppyResults
  } catch {
    return null
  }
}
