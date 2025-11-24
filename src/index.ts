import * as core from '@actions/core';
import { GlueClient } from '@aws-sdk/client-glue';
import {
  addPartition,
  deletePartition,
  partitionExists,
  parsePartitionValues,
  buildS3Location,
  PartitionConfig
} from './partition';

async function run(): Promise<void> {
  try {
    // Get inputs
    const operation = core.getInput('operation', { required: true }).toLowerCase();
    const database = core.getInput('database', { required: true });
    const table = core.getInput('table', { required: true });
    const partitionValuesStr = core.getInput('partition-values', { required: true });
    const s3Bucket = core.getInput('s3-bucket');
    const s3Prefix = core.getInput('s3-prefix');
    const catalogId = core.getInput('catalog-id') || undefined;
    const ifNotExistsStr = core.getInput('if-not-exists') || 'true';
    const storageDescriptor = core.getInput('storage-descriptor') || undefined;

    // Validate operation
    const validOperations = ['add', 'delete', 'exists'];
    if (!validOperations.includes(operation)) {
      throw new Error(
        `Invalid operation: "${operation}". Must be one of: ${validOperations.join(', ')}`
      );
    }

    core.info(`AWS Glue Partition Manager - Operation: ${operation}`);
    core.info(`Database: ${database}`);
    core.info(`Table: ${table}`);

    // Parse partition values
    const { keys, values } = parsePartitionValues(partitionValuesStr);
    core.info(`Partition keys: [${keys.join(', ')}]`);
    core.info(`Partition values: [${values.join(', ')}]`);

    // Build S3 location if bucket and prefix provided
    let location: string | undefined;
    if (s3Bucket && s3Prefix) {
      location = buildS3Location(s3Bucket, s3Prefix);
    }

    // Validate location for add operation
    if (operation === 'add' && !location) {
      throw new Error('s3-bucket and s3-prefix are required for "add" operation');
    }

    // Parse boolean flag
    const ifNotExists = ifNotExistsStr.toLowerCase() === 'true';

    // Create Glue client (uses AWS credentials from environment)
    const client = new GlueClient({});

    // Build configuration
    const config: PartitionConfig = {
      database,
      table,
      partitionValues: values,
      location,
      catalogId,
      ifNotExists,
      storageDescriptor
    };

    // Execute operation
    let result;
    switch (operation) {
      case 'add':
        result = await addPartition(client, config);
        break;
      case 'delete':
        result = await deletePartition(client, config);
        break;
      case 'exists':
        result = await partitionExists(client, config);
        break;
      default:
        throw new Error(`Unexpected operation: ${operation}`);
    }

    // Handle result
    if (!result.success) {
      throw new Error(result.error || 'Operation failed');
    }

    // Set outputs
    core.setOutput('success', 'true');
    core.setOutput('exists', result.exists ? 'true' : 'false');
    core.setOutput('partition-values', values.join(';'));

    if (result.location) {
      core.setOutput('location', result.location);
    }

    if (result.createdAt) {
      core.setOutput('created-at', result.createdAt.toISOString());
    }

    // Summary
    core.info('');
    core.info('='.repeat(50));
    core.info('Operation completed successfully');
    core.info(`Operation: ${operation}`);
    core.info(`Partition exists: ${result.exists}`);
    if (result.location) {
      core.info(`Location: ${result.location}`);
    }
    core.info('='.repeat(50));

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
    core.setOutput('success', 'false');
  }
}

run();
