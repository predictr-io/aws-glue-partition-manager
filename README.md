# AWS Glue Partition Manager

A GitHub Action to manage AWS Glue catalog partitions. Seamlessly add, delete, and check partition existence in your data lake workflows.

## Features

- **Add partitions** - Register new partitions after data lands in S3
- **Delete partitions** - Remove old partitions for data lifecycle management
- **Check existence** - Conditionally execute workflow steps based on partition presence
- **Idempotent operations** - Safe to run multiple times with `if-not-exists` flag
- **Table inheritance** - Automatically inherits storage descriptor from parent table
- **Cross-account support** - Works with cross-account Glue catalogs
- **Custom storage descriptors** - Override table defaults when needed

## Prerequisites

Configure AWS credentials before using this action. We recommend `aws-actions/configure-aws-credentials@v4`:

```yaml
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/my-github-actions-role
    aws-region: us-east-1
```

## Usage

### Add Partition

Register a new partition after uploading data to S3:

```yaml
- name: Add partition
  uses: predictr-io/aws-glue-partition-manager@v1
  with:
    operation: 'add'
    database: 'analytics'
    table: 'events'
    partition-values: 'date=2025-11-24'
    s3-bucket: 'data-lake'
    s3-prefix: 'raw/events/date=2025-11-24'
```

### Multiple Partition Keys

For tables with multiple partition keys:

```yaml
- name: Add partition with multiple keys
  uses: predictr-io/aws-glue-partition-manager@v1
  with:
    operation: 'add'
    database: 'analytics'
    table: 'events'
    partition-values: 'year=2025;month=11;day=24'
    s3-bucket: 'data-lake'
    s3-prefix: 'raw/events/year=2025/month=11/day=24'
```

### Check Partition Existence

Conditionally execute steps based on whether a partition exists:

```yaml
- name: Check if partition exists
  id: check
  uses: predictr-io/aws-glue-partition-manager@v1
  with:
    operation: 'exists'
    database: 'analytics'
    table: 'events'
    partition-values: 'date=2025-11-24'

- name: Process only if partition exists
  if: steps.check.outputs.exists == 'true'
  run: |
    echo "Partition found at: ${{ steps.check.outputs.location }}"
    echo "Created at: ${{ steps.check.outputs.created-at }}"
```

### Delete Partition

Remove old partitions for data retention:

```yaml
- name: Delete old partition
  uses: predictr-io/aws-glue-partition-manager@v1
  with:
    operation: 'delete'
    database: 'analytics'
    table: 'events'
    partition-values: 'date=2024-01-01'
```

### Complete Pipeline Example

Ingest data, add partition, validate:

```yaml
name: Daily Data Pipeline

on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Download data to S3
        uses: predictr-io/url-to-s3@v1
        with:
          url: 'https://api.example.com/daily-export'
          s3-bucket: 'data-lake'
          s3-key: 'raw/events/date=${{ env.DATE }}/data.json'

      - name: Register partition in Glue
        id: add-partition
        uses: predictr-io/aws-glue-partition-manager@v1
        with:
          operation: 'add'
          database: 'analytics'
          table: 'events_raw'
          partition-values: 'date=${{ env.DATE }}'
          s3-bucket: 'data-lake'
          s3-prefix: 'raw/events/date=${{ env.DATE }}'

      - name: Verify partition
        run: |
          echo "Partition added: ${{ steps.add-partition.outputs.exists }}"
          echo "Location: ${{ steps.add-partition.outputs.location }}"
```

## Inputs

### Required Inputs

| Input | Description |
|-------|-------------|
| `operation` | Operation to perform: `add`, `delete`, or `exists` |
| `database` | Glue database name |
| `table` | Glue table name |
| `partition-values` | Partition values as `key=value` pairs (semicolon-separated for multiple keys) |

### S3 Location Inputs (Required for "add" operation)

| Input | Description |
|-------|-------------|
| `s3-bucket` | S3 bucket name for partition location |
| `s3-prefix` | S3 prefix/path for partition location |

### Optional Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `catalog-id` | AWS account ID for cross-account catalog access | Current account |
| `if-not-exists` | For "add" operation: skip if partition exists without error | `true` |
| `storage-descriptor` | Custom storage descriptor as JSON (overrides table inheritance) | Inherits from table |

## Outputs

| Output | Description |
|--------|-------------|
| `success` | Whether the operation succeeded (`true`/`false`) |
| `exists` | Whether the partition exists after operation |
| `partition-values` | Partition values that were operated on (semicolon-separated) |
| `location` | S3 location of the partition (for "add" and "exists" operations) |
| `created-at` | Partition creation timestamp ISO 8601 format (for "exists" operation when found) |

## Partition Value Formats

### Single Partition Key
```yaml
partition-values: 'date=2025-11-24'
```

### Multiple Partition Keys
```yaml
partition-values: 'year=2025;month=11;day=24'
```

Partition keys must match the table's partition key order.

## Storage Descriptor Inheritance

By default, the action inherits the storage descriptor (schema, SerDe, input/output formats) from the parent table. This is the recommended approach for most use cases.

### Custom Storage Descriptor

For advanced use cases, provide a custom storage descriptor:

```yaml
- name: Add partition with custom storage descriptor
  uses: predictr-io/aws-glue-partition-manager@v1
  with:
    operation: 'add'
    database: 'analytics'
    table: 'events'
    partition-values: 'date=2025-11-24'
    s3-bucket: 'data-lake'
    s3-prefix: 'raw/events/date=2025-11-24'
    storage-descriptor: |
      {
        "Columns": [
          {"Name": "event_id", "Type": "string"},
          {"Name": "timestamp", "Type": "bigint"}
        ],
        "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
        "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        "SerdeInfo": {
          "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe"
        }
      }
```

## Cross-Account Access

Access Glue catalogs in different AWS accounts:

```yaml
- name: Add partition to cross-account catalog
  uses: predictr-io/aws-glue-partition-manager@v1
  with:
    operation: 'add'
    database: 'shared_analytics'
    table: 'events'
    partition-values: 'date=2025-11-24'
    s3-bucket: 'cross-account-bucket'
    s3-prefix: 'data/events/date=2025-11-24'
    catalog-id: '987654321098'
```

Ensure your IAM role has the necessary cross-account permissions.

## Error Handling

The action handles common scenarios gracefully:

- **Add existing partition with `if-not-exists=true`**: Succeeds without error
- **Delete non-existent partition**: Succeeds without error
- **Check non-existent partition**: Returns `exists=false` without error
- **Missing S3 location for "add" operation**: Fails with clear error message
- **Invalid partition format**: Fails with validation error
- **AWS permission errors**: Fails with AWS SDK error message

## Development

### Setup
```bash
cd aws-glue-partition-manager
npm install
```

### Build
```bash
npm run build
```

Compiles TypeScript and bundles into `dist/index.js` using `@vercel/ncc`.

### Release Process

1. Make changes and commit to main
2. Build and commit dist/:
   ```bash
   npm run build
   git add dist/
   git commit -m "Build dist/ for release"
   ```
3. Create and push version tag:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
4. GitHub Actions automatically:
   - Verifies dist/ is committed and up-to-date
   - Creates GitHub Release with release notes
   - Updates major version tag (e.g., `v1` → `v1.0.0`)

Users can reference: `predictr-io/aws-glue-partition-manager@v1` (recommended) or `@v1.0.0` (specific version).

## License

MIT

## Contributing

Contributions welcome! Please submit a Pull Request.
