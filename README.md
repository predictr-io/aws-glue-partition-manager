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

Clone and install dependencies:

```bash
git clone https://github.com/predictr-io/aws-glue-partition-manager.git
cd aws-glue-partition-manager
npm install
```

### Development Scripts

```bash
# Build the action (compile TypeScript + bundle with dependencies)
npm run build

# Run TypeScript type checking
npm run type-check

# Run ESLint
npm run lint

# Run all checks (type-check + lint)
npm run check
```

### Build Process

The build process uses `@vercel/ncc` to compile TypeScript and bundle all dependencies into a single `dist/index.js` file:

```bash
npm run build
```

**Output:**
- `dist/index.js` - Bundled action (2MB, includes AWS SDK)
- `dist/index.js.map` - Source map for debugging
- `dist/licenses.txt` - License information for bundled dependencies

**Important:** The `dist/` directory **must be committed** to git. GitHub Actions runs the compiled code directly from the repository.

### Making Changes

1. **Edit source files** in `src/`
2. **Run checks** to validate:
   ```bash
   npm run check
   ```
3. **Build** to update `dist/`:
   ```bash
   npm run build
   ```
4. **Test locally** (optional) - Use [act](https://github.com/nektos/act) or create a test workflow
5. **Commit everything** including `dist/`:
   ```bash
   git add src/ dist/
   git commit -m "Description of changes"
   ```

### Release Process

Follow these steps to create a new release:

#### 1. Make and Test Changes

```bash
# Make your changes to src/
# Run checks
npm run check

# Build
npm run build

# Commit source and dist/
git add .
git commit -m "Add new feature"
git push origin main
```

#### 2. Create Version Tag

```bash
# Create annotated tag (use semantic versioning)
git tag -a v0.2.0 -m "Release v0.2.0: Description of changes"

# Push tag to trigger release workflow
git push origin v0.2.0
```

#### 3. Automated Release

GitHub Actions automatically:
- ✓ Verifies `dist/` is committed
- ✓ Verifies `dist/` is up-to-date with source
- ✓ Creates GitHub Release with auto-generated notes
- ✓ Updates major version tag (e.g., `v0` → `v0.2.0`)

#### 4. Version References

Users can reference the action:
- **Recommended:** `predictr-io/aws-glue-partition-manager@v0` (floating major version, gets updates)
- **Pinned:** `predictr-io/aws-glue-partition-manager@v0.2.0` (specific version, never changes)

### Troubleshooting

**Release workflow fails with "dist/ is out of date":**
```bash
npm run build
git add dist/
git commit -m "Update dist/ for release"
git tag -f v0.2.0  # Re-tag
git push -f origin v0.2.0
```

**ESLint errors:**
```bash
npm run lint  # See errors
# Fix issues, then:
npm run check  # Verify all checks pass
```

**TypeScript errors:**
```bash
npm run type-check  # See type errors
```

## License

MIT

## Contributing

Contributions welcome! Please submit a Pull Request.
