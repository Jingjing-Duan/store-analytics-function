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

app.http('GetDashboardData', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const containerName = process.env.BLOB_CONTAINER_NAME || 'adfoutput';
      //const fileName = process.env.BLOB_FILE_NAME || 'output.json';

      const serviceClient = getBlobServiceClient();
      const containerClient = serviceClient.getContainerClient(containerName);

      const results = {};

      for(const file of files){
        const blobClient = containerClient.getBlobClient(file);

        const exists = await blobClient.exists();

        if (!exists) {
          return {
            status: 404,
            jsonBody: {
              message: `Blob not found: ${containerName}/${file}`
            }
          };
        }

        const downloadResponse = await blobClient.download();
        const text = await streamToText(downloadResponse.readableStreamBody);

        let jsonData;
        try {
          jsonData = JSON.parse(text);
          results[file.replace(".json","")] = jsonData;
        } catch (parseError) {
          return {
            status: 500,
            jsonBody: {
              message: 'Blob exists, but content is not valid JSON.',
              error: parseError.message
            }
          };
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
          message: 'Failed to read output.json from Blob Storage.',
          error: error.message
        }
      };
    }
  }
});