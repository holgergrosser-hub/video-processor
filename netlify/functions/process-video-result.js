const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'jobId erforderlich' })
    };
  }

  connectLambda(event);
  const store = getStore('video-processor-jobs');
  const job = await store.get(jobId, { type: 'json' });

  if (!job) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Job nicht gefunden' })
    };
  }

  if (job.status === 'done') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(job.result)
    };
  }

  if (job.status === 'error') {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Video-Verarbeitung fehlgeschlagen',
        details: job.error?.message || 'Unbekannter Fehler'
      })
    };
  }

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      success: false,
      status: job.status,
      stage: job.stage,
      updatedAt: job.updatedAt,
      meta: job.meta,
      jobId
    })
  };
};
