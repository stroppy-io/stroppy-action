# Stroppy Benchmark Action

GitHub Action for running [Stroppy](https://github.com/stroppy-io/stroppy)
database benchmarks in CI/CD pipelines.

Stroppy is a command-line tool built on k6/xk6 for database load testing. This
action installs Stroppy, runs benchmarks (custom scripts or built-in presets),
and uploads results as workflow artifacts.

## Usage

### Run a built-in preset

```yaml
- uses: stroppy-io/stroppy-action@main
  with:
    preset: tpcb
    driver-url: ${{ secrets.DATABASE_URL }}
    duration: 10m
    vus: 4
    scale-factor: 10
```

### Run a custom script

```yaml
- uses: stroppy-io/stroppy-action@main
  with:
    script: ./benchmarks/my-bench.ts
    sql-file: ./benchmarks/schema.sql
    driver-url: ${{ secrets.DATABASE_URL }}
    duration: 30m
    vus: 8
```

### Pin a specific Stroppy version

```yaml
- uses: stroppy-io/stroppy-action@main
  with:
    version: v1.2.3
    preset: simple
    driver-url: ${{ secrets.DATABASE_URL }}
```

### Use outputs in subsequent steps

```yaml
- uses: stroppy-io/stroppy-action@main
  id: bench
  with:
    preset: tpcb
    driver-url: ${{ secrets.DATABASE_URL }}

- run: echo "Benchmark exited with code ${{ steps.bench.outputs.exit-code }}"
```

## Inputs

| Input           | Required | Default           | Description                                                                |
| --------------- | -------- | ----------------- | -------------------------------------------------------------------------- |
| `version`       | No       | `latest`          | Stroppy release tag (e.g. `v1.2.3`) or `latest`                            |
| `script`        | No       | `''`              | Path to a custom `.ts` benchmark script (mutually exclusive with `preset`) |
| `sql-file`      | No       | `''`              | Path to a `.sql` file (only used with `script`)                            |
| `preset`        | No       | `''`              | Built-in preset: `tpcb`, `tpcc`, `tpcds`, `simple`, `execute_sql`          |
| `driver-url`    | **Yes**  |                   | Database connection URL                                                    |
| `scale-factor`  | No       | `''`              | Scale factor for the workload                                              |
| `duration`      | No       | `''`              | Test duration (e.g. `1h`, `30m`)                                           |
| `vus`           | No       | `''`              | Number of virtual users                                                    |
| `log-level`     | No       | `info`            | Log level: `debug`, `info`, `warn`, `error`                                |
| `k6-args`       | No       | `''`              | Additional k6 CLI arguments                                                |
| `artifact-name` | No       | `stroppy-results` | Name for the uploaded results artifact                                     |

Either `script` or `preset` must be provided (but not both).

## Outputs

| Output         | Description                    |
| -------------- | ------------------------------ |
| `exit-code`    | Exit code from the Stroppy run |
| `results-file` | Path to the JSON results file  |
| `artifact-id`  | ID of the uploaded artifact    |

## How it works

1. **Install** — Downloads the Stroppy binary from GitHub Releases (with
   tool-cache for fast re-runs).
1. **Run** — Executes the benchmark:
   - **Custom script**: `stroppy run <script> [sql] -- <k6-args>`
   - **Preset**: generates files via `stroppy gen`, then runs them.
1. **Collect** — Sets outputs and uploads the JSON results file as a workflow
   artifact.

## License

[MIT](LICENSE)
