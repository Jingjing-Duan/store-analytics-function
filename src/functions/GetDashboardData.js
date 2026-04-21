const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const files = [
  "abandon.json",
  "conversion.json",
  "price.json",
  "riskstatus.json",
  "totalorder.json",
  "totalrevenue.json"
];

let blobServiceClient;

function getBlobServiceClient() {
  if (!blobServiceClient) {
    const connectionString = process.env.BLOB_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('Missing BLOB_CONNECTION_STRING.');
    }
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  }
  return blobServiceClient;
}

async function streamToText(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    readableStream.on('data', (chunk) => {
      chunks.push(chunk.toString());
    });

    readableStream.on('end', () => {
      resolve(chunks.join(''));
    });

    readableStream.on('error', reject);
  });
}

// 先按正常 JSON 解析；失败后再尝试按 NDJSON / 多行对象 解析
function parseJsonWithFallback(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  // 1) 正常 JSON
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // ignore, try fallback
  }

  // 2) 多行 JSON 对象
  // 例如：
  // {"a":1}
  // {"b":2}
  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length > 1) {
    const parsedItems = [];

    for (const line of lines) {
      parsedItems.push(JSON.parse(line));
    }

    return parsedItems;
  }

  // 3) 如果还是不行，抛错
  throw new Error('Invalid JSON format.');
}

app.http('GetDashboardData', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const containerName = process.env.BLOB_CONTAINER_NAME || 'adfoutput';
      const serviceClient = getBlobServiceClient();
      const containerClient = serviceClient.getContainerClient(containerName);

      const results = {};

      for (const file of files) {
        const blobClient = containerClient.getBlobClient(file);
        const key = file.replace(".json", "");

        const exists = await blobClient.exists();

        if (!exists) {
          results[key] = null;
          continue;
        }

        const downloadResponse = await blobClient.download();
        const text = await streamToText(downloadResponse.readableStreamBody);

        let jsonData;
        try {
          jsonData = parseJsonWithFallback(text);
        } catch (err) {
          results[key] = { error: "Invalid JSON" };
          continue;
        }

        if (key === "price" || key === "riskstatus" || key === "abandon") {
          if (Array.isArray(jsonData)) {
            results[key] = jsonData;
          } else if (jsonData && typeof jsonData === "object") {
            results[key] = [jsonData];
          } else {
            results[key] = [];
          }
        } else if (key === "totalorder") {
          results[key] = jsonData?.NumOrders || 0;
        } else if (key === "totalrevenue") {
          results[key] = jsonData?.Revenue || 0;
        } else if (key === "conversion") {
          results[key] = jsonData || {};
        } else {
          results[key] = jsonData;
        }
      }

      return {
        status: 200,
        jsonBody: results
      };
    } catch (error) {
      context.error('Error reading blob:', error);

      return {
        status: 500,
        jsonBody: {
          message: 'Failed to read dashboard data from Blob Storage.',
          error: error.message
        }
      };
    }
  }
});