const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const speech = require('@google-cloud/speech');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { videoUrl, driveFileId, sensitivity = 0.15 } = JSON.parse(event.body);

    if (!videoUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'videoUrl erforderlich' })
      };
    }

    console.log('Verarbeite Video:', driveFileId);

    // Temporäre Dateien
    const tempDir = '/tmp';
    const videoPath = path.join(tempDir, `${driveFileId}.mp4`);
    const audioPath = path.join(tempDir, `${driveFileId}.wav`);
    const screenshotsDir = path.join(tempDir, 'screenshots');

    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    // 1. Video herunterladen
    await downloadVideo(videoUrl, videoPath);

    // 2. Screenshots extrahieren (bei Szenenwechseln)
    const screenshots = await extractScreenshots(videoPath, screenshotsDir, sensitivity);

    // 3. Audio extrahieren
    await extractAudio(videoPath, audioPath);

    // 4. Audio transkribieren
    const transcript = await transcribeAudio(audioPath);

    // 5. Screenshots als Base64 zurückgeben
    const screenshotData = screenshots.map(file => {
      const filePath = path.join(screenshotsDir, file);
      const imageBuffer = fs.readFileSync(filePath);
      return {
        filename: file,
        timestamp: extractTimestamp(file),
        base64: imageBuffer.toString('base64')
      };
    });

    // Aufräumen
    cleanupFiles([videoPath, audioPath, screenshotsDir]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        screenshots: screenshotData,
        transcript: transcript,
        totalScreenshots: screenshots.length,
        videoId: driveFileId
      })
    };

  } catch (error) {
    console.error('Fehler bei Video-Verarbeitung:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Video-Verarbeitung fehlgeschlagen',
        details: error.message
      })
    };
  }
};

// Video herunterladen
async function downloadVideo(url, outputPath) {
  const https = require('https');
  const file = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// Screenshots extrahieren bei Szenenwechseln
function extractScreenshots(videoPath, outputDir, sensitivity) {
  return new Promise((resolve, reject) => {
    const screenshots = [];
    
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

// Audio extrahieren
function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([
        '-vn',           // kein Video
        '-acodec pcm_s16le',  // WAV Format für Speech-to-Text
        '-ar 16000',     // 16kHz Sample Rate
        '-ac 1'          // Mono
      ])
      .output(audioPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Audio transkribieren mit Google Speech-to-Text
async function transcribeAudio(audioPath) {
  try {
    // Wenn Google Cloud Credentials vorhanden sind
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
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

      // Mit Timestamps
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
    } else {
      return {
        fullText: 'Transkription nicht verfügbar (Google Cloud Credentials fehlen)',
        timestamped: []
      };
    }
  } catch (error) {
    console.error('Transkriptions-Fehler:', error);
    return {
      fullText: 'Transkription fehlgeschlagen',
      timestamped: [],
      error: error.message
    };
  }
}

// Timestamp aus Dateinamen extrahieren
function extractTimestamp(filename) {
  // frame_0001.png -> Frame 1
  const match = filename.match(/frame_(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

// Sekunden zu MM:SS formatieren
function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Temporäre Dateien löschen
function cleanupFiles(paths) {
  paths.forEach(p => {
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
