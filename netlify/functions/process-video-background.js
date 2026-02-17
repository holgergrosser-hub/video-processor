const { connectLambda, getStore } = require('@netlify/blobs');
// NOTE: Keep this file's top-level requires minimal.
// Google Apps Script (UrlFetch) often triggers a 504 "Inactivity Timeout" if the
// server doesn't send a response quickly enough. Heavy requires (ffmpeg-static,
// google-cloud libs) can make cold starts exceed that.

exports.handler = (event, context, callback) => {
  // Don't keep the response waiting for the event loop.
  // (We respond immediately and continue work in the background.)
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') {
    return callback(null, { statusCode: 200, headers, body: '' });
  }

  if (event.httpMethod !== 'POST') {
    return callback(null, {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    });
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body || '{}');
  } catch (e) {
    return callback(null, {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' })
    });
  }

  const { videoUrl, driveFileId, sensitivity = 0.15 } = parsedBody;

  if (!videoUrl || !driveFileId) {
    return callback(null, {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'videoUrl und driveFileId erforderlich' })
    });
  }

  const jobId = `${driveFileId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Respond immediately (prevents 504 / inactivity timeouts)
  callback(null, {
    statusCode: 202,
    headers,
    body: JSON.stringify({ success: true, jobId })
  });

  // Continue processing in the background (Netlify background function)
  (async () => {
    try {
      // Initialize Netlify Blobs after the response has been sent.
      connectLambda(event);
      const store = getStore('video-processor-jobs');

      const fs = require('fs');
      const path = require('path');

      // Heavy dependencies are loaded lazily to keep cold start fast.
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegPath = require('ffmpeg-static');

      const resolvedFfmpegPath = process.env.FFMPEG_PATH || ffmpegPath;
      if (!resolvedFfmpegPath || !fs.existsSync(resolvedFfmpegPath)) {
        console.error('FFmpeg binary not found. Resolved path:', resolvedFfmpegPath);
        console.error('Tip: In Netlify, keep ffmpeg-static as external_node_modules so __dirname points to node_modules.');
      } else {
        console.log('Using ffmpeg binary at:', resolvedFfmpegPath);
      }

      ffmpeg.setFfmpegPath(resolvedFfmpegPath);

      await store.setJSON(jobId, {
        status: 'processing',
        jobId,
        driveFileId,
        createdAt: new Date().toISOString()
      });

      console.log('Background job started:', jobId);

      const tempDir = '/tmp';
      const videoPath = path.join(tempDir, `${jobId}.mp4`);
      const audioPath = path.join(tempDir, `${jobId}.wav`);
      const screenshotsDir = path.join(tempDir, `screenshots-${jobId}`);

      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      await downloadVideo(videoUrl, videoPath, { fs, Readable: require('stream').Readable });
      const screenshots = await extractScreenshots(ffmpeg, videoPath, screenshotsDir, sensitivity, { fs, path });
      await extractAudio(ffmpeg, videoPath, audioPath);
      const transcript = await transcribeAudio(audioPath, { fs });

      const screenshotData = screenshots.map(file => {
        const filePath = path.join(screenshotsDir, file);
        const imageBuffer = fs.readFileSync(filePath);
        return {
          filename: file,
          timestamp: extractTimestamp(file),
          base64: imageBuffer.toString('base64')
        };
      });

      const result = {
        success: true,
        screenshots: screenshotData,
        transcript,
        totalScreenshots: screenshots.length,
        videoId: driveFileId
      };

      await store.setJSON(jobId, {
        status: 'done',
        jobId,
        driveFileId,
        completedAt: new Date().toISOString(),
        result
      });

      cleanupFiles([videoPath, audioPath, screenshotsDir], { fs });
      console.log('Background job finished:', jobId);
    } catch (error) {
      console.error('Background job failed:', jobId, error);
      try {
        connectLambda(event);
        const store = getStore('video-processor-jobs');
        await store.setJSON(jobId, {
          status: 'error',
          jobId,
          driveFileId,
          failedAt: new Date().toISOString(),
          error: {
            message: error.message,
            stack: error.stack
          }
        });
      } catch (storeError) {
        console.error('Failed writing error status to blob store:', storeError);
      }
    }
  })();
};

async function downloadVideo(url, outputPath, { fs, Readable }) {
  const { pipeline } = require('stream/promises');

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'video-processor/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Video download failed: HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    const bodyPreview = (await response.text()).slice(0, 400);
    throw new Error(
      'Downloaded content is HTML, not a video file. ' +
      'This usually means the Google Drive link is not a direct download (redirect/confirmation required). ' +
      `Content-Type=${contentType}. Preview=${JSON.stringify(bodyPreview)}`
    );
  }

  if (!response.body) {
    throw new Error('Video download failed: empty response body');
  }

  const file = fs.createWriteStream(outputPath);
  await pipeline(Readable.fromWeb(response.body), file);

  const stat = fs.statSync(outputPath);
  if (!stat.size || stat.size < 1024) {
    throw new Error(`Downloaded video file too small (${stat.size} bytes). contentType=${contentType}`);
  }
}

function extractScreenshots(ffmpeg, videoPath, outputDir, sensitivity, { fs, path }) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        `-vf select='gt(scene,${sensitivity})',showinfo`,
        '-vsync vfr'
      ])
      .output(path.join(outputDir, 'frame_%04d.png'))
      .on('end', () => {
        const files = fs.readdirSync(outputDir)
          .filter(f => f.endsWith('.png'))
          .sort();
        resolve(files);
      })
      .on('error', reject)
      .run();
  });
}

function extractAudio(ffmpeg, videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn',
        '-acodec pcm_s16le',
        '-ar 16000',
        '-ac 1'
      ])
      .output(audioPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function transcribeAudio(audioPath, { fs }) {
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      const speech = require('@google-cloud/speech');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      const client = new speech.SpeechClient({ credentials });

      const audioBytes = fs.readFileSync(audioPath).toString('base64');

      const request = {
        audio: { content: audioBytes },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'de-DE',
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true
        }
      };

      const [response] = await client.recognize(request);
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');

      const timestampedTranscript = response.results.map(result => {
        const alternative = result.alternatives[0];
        const startTime = alternative.words[0]?.startTime?.seconds || 0;
        return {
          timestamp: formatTimestamp(startTime),
          text: alternative.transcript
        };
      });

      return {
        fullText: transcription,
        timestamped: timestampedTranscript
      };
    }

    return {
      fullText: 'Transkription nicht verfügbar (Google Cloud Credentials fehlen)',
      timestamped: []
    };
  } catch (error) {
    console.error('Transkriptions-Fehler:', error);
    return {
      fullText: 'Transkription fehlgeschlagen',
      timestamped: [],
      error: error.message
    };
  }
}

function extractTimestamp(filename) {
  const match = filename.match(/frame_(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function cleanupFiles(pathsToDelete, { fs }) {
  pathsToDelete.forEach(p => {
    try {
      if (fs.existsSync(p)) {
        if (fs.lstatSync(p).isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      }
    } catch (err) {
      console.error('Cleanup Fehler:', err);
    }
  });
}
