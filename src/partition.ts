import {
  GlueClient,
  GetPartitionCommand,
  CreatePartitionCommand,
  DeletePartitionCommand,
  GetTableCommand,
  StorageDescriptor,
  EntityNotFoundException,
  AlreadyExistsException
} from '@aws-sdk/client-glue';
import * as core from '@actions/core';

export interface PartitionConfig {
  database: string;
  table: string;
  partitionValues: string[];
  location?: string;
  catalogId?: string;
  ifNotExists?: boolean;
  storageDescriptor?: string; // JSON string
}

export interface PartitionResult {
  success: boolean;
  exists: boolean;
  partitionValues: string[];
  location?: string;
  createdAt?: Date;
  error?: string;
}

/**
 * Parse partition values from string format to array
 * Supports formats:
 * - "date=2025-11-24" → ["2025-11-24"]
 * - "year=2025;month=11;day=24" → ["2025", "11", "24"]
 */
export function parsePartitionValues(partitionValuesStr: string): { keys: string[]; values: string[] } {
  const pairs = partitionValuesStr
    .split(';')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const keys: string[] = [];
  const values: string[] = [];

  for (const pair of pairs) {
    const [key, value] = pair.split('=').map(s => s.trim());
    if (!key || value === undefined) {
      throw new Error(`Invalid partition value format: "${pair}". Expected format: key=value`);
    }
    keys.push(key);
    values.push(value);
  }

  if (values.length === 0) {
    throw new Error('No partition values provided');
  }

  return { keys, values };
}

/**
 * Build S3 location from bucket and prefix
 */
export function buildS3Location(bucket: string, prefix: string): string {
  // Remove leading/trailing slashes from prefix
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  // Ensure location ends with /
  return `s3://${bucket}/${cleanPrefix}/`;
}

/**
 * Check if a partition exists in the Glue catalog
 */
export async function partitionExists(
  client: GlueClient,
  config: PartitionConfig
): Promise<PartitionResult> {
  try {
    core.info(`Checking if partition exists in ${config.database}.${config.table}`);
    core.info(`Partition values: [${config.partitionValues.join(', ')}]`);

    const command = new GetPartitionCommand({
      CatalogId: config.catalogId,
      DatabaseName: config.database,
      TableName: config.table,
      PartitionValues: config.partitionValues
    });

    const response = await client.send(command);

    if (response.Partition) {
      core.info('✓ Partition exists');
      return {
        success: true,
        exists: true,
        partitionValues: config.partitionValues,
        location: response.Partition.StorageDescriptor?.Location,
        createdAt: response.Partition.CreationTime
      };
    }

    return {
      success: true,
      exists: false,
      partitionValues: config.partitionValues
    };
  } catch (error) {
    if (error instanceof EntityNotFoundException) {
      core.info('✓ Partition does not exist');
      return {
        success: true,
        exists: false,
        partitionValues: config.partitionValues
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to check partition existence: ${errorMessage}`);
    return {
      success: false,
      exists: false,
      partitionValues: config.partitionValues,
      error: errorMessage
    };
  }
}

/**
 * Get table information to inherit storage descriptor
 */
async function getTableStorageDescriptor(
  client: GlueClient,
  database: string,
  table: string,
  catalogId?: string
): Promise<StorageDescriptor | undefined> {
  try {
    const command = new GetTableCommand({
      CatalogId: catalogId,
      DatabaseName: database,
      Name: table
    });

    const response = await client.send(command);
    return response.Table?.StorageDescriptor;
  } catch (error) {
    core.warning(`Could not retrieve table storage descriptor: ${error}`);
    return undefined;
  }
}

/**
 * Add a partition to the Glue catalog
 */
export async function addPartition(
  client: GlueClient,
  config: PartitionConfig
): Promise<PartitionResult> {
  try {
    if (!config.location) {
      throw new Error('S3 location (s3-bucket and s3-prefix) is required for add operation');
    }

    // Check if partition already exists
    if (config.ifNotExists) {
      const existsResult = await partitionExists(client, config);
      if (existsResult.exists) {
        core.info('✓ Partition already exists, skipping creation (if-not-exists=true)');
        return {
          success: true,
          exists: true,
          partitionValues: config.partitionValues,
          location: existsResult.location
        };
      }
    }

    core.info(`Adding partition to ${config.database}.${config.table}`);
    core.info(`Partition values: [${config.partitionValues.join(', ')}]`);
    core.info(`Location: ${config.location}`);

    // Get storage descriptor from table or use custom one
    let storageDescriptor: StorageDescriptor | undefined;

    if (config.storageDescriptor) {
      // Parse custom storage descriptor
      storageDescriptor = JSON.parse(config.storageDescriptor);
      core.info('Using custom storage descriptor');
    } else {
      // Inherit from table
      storageDescriptor = await getTableStorageDescriptor(
        client,
        config.database,
        config.table,
        config.catalogId
      );
      if (storageDescriptor) {
        core.info('Inherited storage descriptor from table');
      }
    }

    // Update location in storage descriptor
    if (storageDescriptor) {
      storageDescriptor.Location = config.location;
    } else {
      // Create minimal storage descriptor if none available
      storageDescriptor = {
        Location: config.location,
        InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        SerdeInfo: {
          SerializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'
        }
      };
      core.warning('No table storage descriptor available, using minimal default');
    }

    const command = new CreatePartitionCommand({
      CatalogId: config.catalogId,
      DatabaseName: config.database,
      TableName: config.table,
      PartitionInput: {
        Values: config.partitionValues,
        StorageDescriptor: storageDescriptor
      }
    });

    await client.send(command);

    core.info('✓ Partition created successfully');

    return {
      success: true,
      exists: true,
      partitionValues: config.partitionValues,
      location: config.location
    };
  } catch (error) {
    if (error instanceof AlreadyExistsException && config.ifNotExists) {
      core.info('✓ Partition already exists (race condition handled)');
      return {
        success: true,
        exists: true,
        partitionValues: config.partitionValues,
        location: config.location
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to add partition: ${errorMessage}`);
    return {
      success: false,
      exists: false,
      partitionValues: config.partitionValues,
      error: errorMessage
    };
  }
}

/**
 * Delete a partition from the Glue catalog
 */
export async function deletePartition(
  client: GlueClient,
  config: PartitionConfig
): Promise<PartitionResult> {
  try {
    core.info(`Deleting partition from ${config.database}.${config.table}`);
    core.info(`Partition values: [${config.partitionValues.join(', ')}]`);

    const command = new DeletePartitionCommand({
      CatalogId: config.catalogId,
      DatabaseName: config.database,
      TableName: config.table,
      PartitionValues: config.partitionValues
    });

    await client.send(command);

    core.info('✓ Partition deleted successfully');

    return {
      success: true,
      exists: false,
      partitionValues: config.partitionValues
    };
  } catch (error) {
    if (error instanceof EntityNotFoundException) {
      core.info('✓ Partition does not exist, nothing to delete');
      return {
        success: true,
        exists: false,
        partitionValues: config.partitionValues
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to delete partition: ${errorMessage}`);
    return {
      success: false,
      exists: false,
      partitionValues: config.partitionValues,
      error: errorMessage
    };
  }
}
