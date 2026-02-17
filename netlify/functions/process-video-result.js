const { connectLambda, getStore } = require('@netlify/blobs');

function parseJobTimestampMs(jobId) {
  if (!jobId || typeof jobId !== 'string') return null;
  const lastDash = jobId.lastIndexOf('-');
  if (lastDash === -1) return null;
  const tail = jobId.slice(lastDash + 1);
  if (!/^\d{10,17}$/.test(tail)) return null;
  const num = Number(tail);
  if (!Number.isFinite(num)) return null;
  // Heuristic: if it's seconds, convert; if it's ms, keep.
  return num < 1_000_000_000_000 ? num * 1000 : num;
}

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
    // Netlify Blobs can be briefly inconsistent right after job start.
    // If the jobId looks fresh (timestamp in jobId), treat as queued.
    const ts = parseJobTimestampMs(jobId);
    if (ts) {
      const ageMs = Date.now() - ts;
      const queuedWindowMs = 10 * 60 * 1000; // 10 minutes
      if (ageMs >= 0 && ageMs < queuedWindowMs) {
        return {
          statusCode: 202,
          headers,
          body: JSON.stringify({
            success: false,
            status: 'queued',
            stage: 'init',
            updatedAt: new Date().toISOString(),
            jobId
          })
        };
      }
    }

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
