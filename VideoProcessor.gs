
/**
 * VIDEO PROZESSOR - Automatische Prozessdokumentation
 * Version: 1.0
 * Autor: Holger Grosser
 * 
 * INSTALLATION:
 * 1. Dieses komplette Script in Google Apps Script einfügen
 * 2. setup() Funktion ausführen (siehe unten)
 * 3. Google Drive Ordner erstellen und IDs eintragen
 * 4. Netlify Function URL eintragen
 * 5. Fertig!
 */

// ============================================================================
// KONFIGURATION - HIER DEINE WERTE EINTRAGEN
// ============================================================================

/**
 * Setup-Funktion: Einmalig ausführen!
 * WICHTIG: Werte in den Zeilen unten anpassen, dann diese Funktion ausführen
 */
function setup() {
  // === HIER DEINE WERTE EINTRAGEN ===
  
  // 1. Deine Netlify Function URL
  // Nach Deployment findest du sie hier: https://app.netlify.com
  // Format: https://DEINE-SITE.netlify.app/.netlify/functions/process-video-background
  // (Background Function: returns immediately, avoids 504 / inactivity timeout)
  const NETLIFY_URL = 'https://video-processor-audit.netlify.app/.netlify/functions/process-video-background';
  
  // 2. Google Drive Ordner-ID für Video-Uploads
  // Erstelle einen Ordner in Google Drive, öffne ihn, kopiere ID aus URL
  // URL sieht aus wie: https://drive.google.com/drive/folders/DIESE-ID-KOPIEREN
  const VIDEO_FOLDER_ID = '1BqlCXt1A60hsAi0cRCdy3KZvSprINYdX';
  
  // 3. Google Drive Ordner-ID für fertige Dokumentationen
  // Gleich wie oben, aber für Output-Ordner
  const OUTPUT_FOLDER_ID = '1_48KPi8c8V__ZSSBWEYN1iopaY3xQYR9';
  
  // === AB HIER NICHTS MEHR ÄNDERN ===
  
  const props = PropertiesService.getScriptProperties();
  
  // Validierung und Speicherung
  let hasErrors = false;
  
  if (NETLIFY_URL && !NETLIFY_URL.includes('DEINE-SITE')) {
    props.setProperty('NETLIFY_FUNCTION_URL', NETLIFY_URL);
    Logger.log('✅ Netlify URL gespeichert');
  } else {
    Logger.log('❌ FEHLER: Bitte NETLIFY_URL im Code anpassen (Zeile 22)');
    hasErrors = true;
  }
  
  if (VIDEO_FOLDER_ID && VIDEO_FOLDER_ID !== 'DEINE-VIDEO-ORDNER-ID-HIER') {
    props.setProperty('VIDEO_FOLDER_ID', VIDEO_FOLDER_ID);
    Logger.log('✅ Video-Ordner ID gespeichert');
  } else {
    Logger.log('❌ FEHLER: Bitte VIDEO_FOLDER_ID im Code anpassen (Zeile 27)');
    hasErrors = true;
  }
  
  if (OUTPUT_FOLDER_ID && OUTPUT_FOLDER_ID !== 'DEINE-OUTPUT-ORDNER-ID-HIER') {
    props.setProperty('OUTPUT_FOLDER_ID', OUTPUT_FOLDER_ID);
    Logger.log('✅ Output-Ordner ID gespeichert');
  } else {
    Logger.log('❌ FEHLER: Bitte OUTPUT_FOLDER_ID im Code anpassen (Zeile 31)');
    hasErrors = true;
  }
  
  if (!hasErrors) {
    Logger.log('\n🎉 Setup erfolgreich abgeschlossen!');
    Logger.log('\nNächster Schritt: testWithExistingVideo() ausführen');
  } else {
    Logger.log('\n⚠️ Setup unvollständig - bitte Fehler beheben');
  }
}

/**
 * Gespeicherte Einstellungen anzeigen
 */
function showSettings() {
  const props = PropertiesService.getScriptProperties();
  
  Logger.log('=== Aktuelle Einstellungen ===');
  Logger.log('NETLIFY_FUNCTION_URL: ' + props.getProperty('NETLIFY_FUNCTION_URL'));
  Logger.log('VIDEO_FOLDER_ID: ' + props.getProperty('VIDEO_FOLDER_ID'));
  Logger.log('OUTPUT_FOLDER_ID: ' + props.getProperty('OUTPUT_FOLDER_ID'));
}

// ============================================================================
// HAUPTFUNKTIONEN
// ============================================================================

/**
 * Hauptfunktion: Video verarbeiten
 * @param {string} fileId - Google Drive Datei-ID des Videos
 */
function processNewVideo(fileId) {
  try {
    Logger.log('🎬 Starte Video-Verarbeitung...');
    
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();
    
    // Nur Videos verarbeiten
    if (!mimeType.includes('video')) {
      Logger.log('⚠️ Keine Video-Datei: ' + mimeType);
      return;
    }
    
    Logger.log('📹 Video gefunden: ' + file.getName());
    
    // 1. Video-URL erstellen (öffentlich teilbar)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const videoUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    Logger.log('📡 Rufe Netlify Function auf...');
    
    // 2. Netlify Function aufrufen
    const result = callVideoProcessor(videoUrl, fileId);
    
    if (!result.success) {
      throw new Error('Video-Verarbeitung fehlgeschlagen: ' + JSON.stringify(result));
    }
    
    Logger.log('✅ Video verarbeitet: ' + result.totalScreenshots + ' Screenshots');
    
    // 3. Prozessdokumentation erstellen
    Logger.log('📄 Erstelle Google Doc...');
    const docId = createProcessDocumentation(file.getName(), result);
    
    // 4. Screenshots in Drive speichern
    Logger.log('💾 Speichere Screenshots...');
    const screenshotFolderId = saveScreenshots(fileId, result.screenshots);
    
    // 5. Email-Benachrichtigung
    Logger.log('📧 Sende Benachrichtigung...');
    sendNotification(file.getName(), docId, screenshotFolderId);
    
    Logger.log('🎉 Fertig! Dokumentation: https://docs.google.com/document/d/' + docId);
    
  } catch (error) {
    Logger.log('❌ FEHLER: ' + error.toString());
    sendErrorNotification(error);
  }
}

/**
 * Ruft die Netlify Function auf
 */
function callVideoProcessor(videoUrl, fileId) {
  const NETLIFY_FUNCTION_URL = PropertiesService.getScriptProperties().getProperty('NETLIFY_FUNCTION_URL');
  
  if (!NETLIFY_FUNCTION_URL) {
    throw new Error('NETLIFY_FUNCTION_URL nicht konfiguriert! Bitte setup() ausführen.');
  }
  
  const jobId = fileId + '-' + new Date().getTime();

  const startPayload = {
    videoUrl: videoUrl,
    driveFileId: fileId,
    sensitivity: 0.15,
    jobId: jobId
  };

  const startOptions = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(startPayload),
    muteHttpExceptions: true
  };

  Logger.log('🚀 Starte Background-Job (Netlify)...');

  const startResponse = UrlFetchApp.fetch(NETLIFY_FUNCTION_URL, startOptions);
  const startCode = startResponse.getResponseCode();
  Logger.log('📥 Start Response Code: ' + startCode);

  if (startCode !== 202 && startCode !== 200) {
    throw new Error('HTTP ' + startCode + ': ' + startResponse.getContentText());
  }

  // Netlify Background Functions return an empty body for 202.
  // We therefore generate the jobId client-side and pass it in the payload.

  const resultUrl = deriveResultUrl_(NETLIFY_FUNCTION_URL);
  Logger.log('⏳ Warte auf Ergebnis... Job: ' + jobId);

  const startedAt = new Date().getTime();
  const maxWaitMs = 20 * 60 * 1000; // 20 Minuten (Netlify Background hat typ. genug Laufzeit)
  let lastStage = '';
  const notFoundGraceMs = 60 * 1000; // 60s: Blob-Eintrag kann minimal verzögert erscheinen

  while (new Date().getTime() - startedAt < maxWaitMs) {
    const pollResponse = UrlFetchApp.fetch(resultUrl + '?jobId=' + encodeURIComponent(jobId), {
      method: 'get',
      muteHttpExceptions: true
    });

    const pollCode = pollResponse.getResponseCode();
    if (pollCode === 200) {
      return JSON.parse(pollResponse.getContentText());
    }

    if (pollCode === 404) {
      // Direkt nach Job-Start kann der Blob-Eintrag noch nicht sichtbar sein.
      // In dieser Grace-Phase behandeln wir 404 wie "noch nicht bereit".
      if (new Date().getTime() - startedAt < notFoundGraceMs) {
        Utilities.sleep(2000);
        continue;
      }

      throw new Error('HTTP 404: ' + pollResponse.getContentText());
    }

    if (pollCode === 202) {
      try {
        const pollBody = JSON.parse(pollResponse.getContentText());
        const stage = pollBody.stage || '';
        if (stage && stage !== lastStage) {
          lastStage = stage;
          Logger.log('⏳ Status: ' + (pollBody.status || 'processing') + ' | Stage: ' + stage);
        }
      } catch (e) {
        // ignore
      }

      Utilities.sleep(10000);
      continue;
    }

    throw new Error('HTTP ' + pollCode + ': ' + pollResponse.getContentText());
  }

  throw new Error('Timeout: Video-Verarbeitung dauert länger als ' + (maxWaitMs / 60000) + ' Minuten.');
}

/**
 * Leitet aus der Background-Function-URL die Result-URL ab.
 */
function deriveResultUrl_(backgroundUrl) {
  if (backgroundUrl.indexOf('process-video-background') !== -1) {
    return backgroundUrl.replace('process-video-background', 'process-video-result');
  }

  // Fallback: wenn jemand noch process-video eingetragen hat
  if (backgroundUrl.indexOf('process-video') !== -1) {
    return backgroundUrl.replace('process-video', 'process-video-result');
  }

  throw new Error('Kann Result-URL nicht ableiten aus: ' + backgroundUrl);
}

/**
 * Erstellt Google Doc mit Prozessdokumentation
 */
function createProcessDocumentation(videoName, result) {
  const OUTPUT_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('OUTPUT_FOLDER_ID');
  
  const docName = `Prozessdokumentation - ${videoName.replace('.mp4', '').replace('.mov', '').replace('.avi', '')}`;
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();
  
  // Titel
  const title = body.appendParagraph(docName);
  title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  
  // Datum
  const date = body.appendParagraph(`Erstellt: ${new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })}`);
  date.setFontSize(10);
  date.setItalic(true);
  
  body.appendHorizontalRule();
  
  // Übersicht
  body.appendParagraph('Übersicht').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(`Anzahl Screenshots: ${result.totalScreenshots}`);
  body.appendParagraph(`Video-ID: ${result.videoId}`);
  
  // Transkript (falls vorhanden)
  if (result.transcript && result.transcript.fullText && result.transcript.fullText !== 'Transkription nicht verfügbar (Google Cloud Credentials fehlen)') {
    body.appendParagraph('');
    const transcriptLabel = body.appendParagraph('Vollständiges Transkript:');
    transcriptLabel.setBold(true);
    
    const transcriptText = body.appendParagraph(result.transcript.fullText);
    transcriptText.setFontSize(9);
    transcriptText.setFontFamily('Courier New');
    transcriptText.setForegroundColor('#666666');
  }
  
  body.appendPageBreak();
  
  // Screenshots
  body.appendParagraph('Prozess-Schritte').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  
  result.screenshots.forEach((screenshot, index) => {
    // Schritt-Nummer
    body.appendParagraph(`Schritt ${index + 1}`).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    
    // Timestamp
    const timestamp = formatFrameToTime(screenshot.timestamp);
    const timestampPara = body.appendParagraph(`⏱️ ${timestamp}`);
    timestampPara.setFontSize(9);
    timestampPara.setItalic(true);
    timestampPara.setForegroundColor('#666666');
    
    // Screenshot einfügen
    try {
      const imageBlob = Utilities.newBlob(
        Utilities.base64Decode(screenshot.base64),
        'image/png',
        screenshot.filename
      );
      
      const image = body.appendImage(imageBlob);
      
      // Bild auf 500px Breite skalieren (behält Seitenverhältnis)
      const width = 500;
      image.setWidth(width);
      
    } catch (e) {
      const errorPara = body.appendParagraph(`⚠️ Fehler beim Laden des Bildes: ${e.toString()}`);
      errorPara.setItalic(true);
      errorPara.setForegroundColor('#cc0000');
    }
    
    // Transkript für diesen Zeitpunkt (falls vorhanden)
    if (result.transcript && result.transcript.timestamped && result.transcript.timestamped.length > 0) {
      const relevantTranscript = findRelevantTranscript(index, result.transcript.timestamped);
      
      if (relevantTranscript) {
        body.appendParagraph('');
        const explanation = body.appendParagraph('💬 Erklärung: ');
        explanation.editAsText().setBold(0, 13, true);
        explanation.appendText(relevantTranscript.text);
      }
    }
    
    body.appendParagraph(''); // Leerzeile
    body.appendHorizontalRule();
  });
  
  // Fußzeile
  body.appendParagraph('');
  const footer = body.appendParagraph('Automatisch erstellt mit Video-Prozessor | QM-Dienstleistungen & OnlineCert.info');
  footer.setFontSize(8);
  footer.setItalic(true);
  footer.setForegroundColor('#999999');
  footer.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  
  // Dokument in Output-Ordner verschieben
  if (OUTPUT_FOLDER_ID) {
    const docFile = DriveApp.getFileById(doc.getId());
    const outputFolder = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
    outputFolder.addFile(docFile);
    DriveApp.getRootFolder().removeFile(docFile);
  }
  
  return doc.getId();
}

/**
 * Speichert Screenshots in Google Drive
 */
function saveScreenshots(videoFileId, screenshots) {
  const OUTPUT_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('OUTPUT_FOLDER_ID');
  
  const videoFile = DriveApp.getFileById(videoFileId);
  const folderName = `Screenshots - ${videoFile.getName().replace('.mp4', '').replace('.mov', '').replace('.avi', '')}`;
  
  const outputFolder = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  const screenshotFolder = outputFolder.createFolder(folderName);
  
  screenshots.forEach(screenshot => {
    const imageBlob = Utilities.newBlob(
      Utilities.base64Decode(screenshot.base64),
      'image/png',
      screenshot.filename
    );
    screenshotFolder.createFile(imageBlob);
  });
  
  return screenshotFolder.getId();
}

/**
 * Findet relevantes Transkript für einen Screenshot
 */
function findRelevantTranscript(screenshotIndex, transcripts) {
  if (!transcripts || transcripts.length === 0) return null;
  
  const index = Math.min(screenshotIndex, transcripts.length - 1);
  return transcripts[index];
}

/**
 * Formatiert Frame-Nummer zu MM:SS
 */
function formatFrameToTime(frameNumber) {
  // Annahme: ~30 fps
  const seconds = Math.floor(frameNumber / 30);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Sendet Erfolgs-Email
 */
function sendNotification(videoName, docId, folderId) {
  const recipient = Session.getActiveUser().getEmail();
  const subject = `✅ Prozessdokumentation fertig: ${videoName}`;
  
  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  
  const body = `
Hallo,

die automatische Prozessdokumentation für "${videoName}" ist fertig!

📄 Dokumentation ansehen:
${docUrl}

📁 Screenshots-Ordner:
${folderUrl}

Viel Erfolg mit deinem Audit-Bericht!

--
Automatisch erstellt von Video-Prozessor
QM-Dienstleistungen & OnlineCert.info
  `;
  
  MailApp.sendEmail(recipient, subject, body);
}

/**
 * Sendet Fehler-Email
 */
function sendErrorNotification(error) {
  const recipient = Session.getActiveUser().getEmail();
  const subject = '❌ Fehler bei Video-Verarbeitung';
  
  const body = `
Fehler bei der Video-Verarbeitung:

${error.toString()}

Stack Trace:
${error.stack || 'Nicht verfügbar'}

Bitte überprüfe:
- Ist die Netlify Function erreichbar?
- Ist das Video-Format unterstützt? (MP4, MOV, AVI)
- Sind die Google Drive Berechtigungen korrekt?

--
Video-Prozessor Error Handler
  `;
  
  MailApp.sendEmail(recipient, subject, body);
}

// ============================================================================
// TEST-FUNKTIONEN
// ============================================================================

/**
 * Test mit existierendem Video
 * ANLEITUNG:
 * 1. Video in Google Drive hochladen
 * 2. Video öffnen, URL anschauen
 * 3. ID aus URL kopieren (der Teil nach /d/ und vor /view)
 * 4. Diese Funktion ausführen und ID eingeben
 */
function testWithExistingVideo() {
  const testFileId = Browser.inputBox(
    'Video-Test',
    'Gib die Google Drive Datei-ID des Videos ein:\n\n' +
    'Tipp: Öffne das Video in Drive, die URL sieht so aus:\n' +
    'https://drive.google.com/file/d/DIESE-ID-KOPIEREN/view',
    Browser.Buttons.OK_CANCEL
  );
  
  if (testFileId && testFileId !== 'cancel') {
    Logger.log('🧪 Starte Test mit Video-ID: ' + testFileId);
    processNewVideo(testFileId);
  } else {
    Logger.log('❌ Test abgebrochen');
  }
}

/**
 * Test der Netlify Connection
 */
function testNetlifyConnection() {
  const NETLIFY_FUNCTION_URL = PropertiesService.getScriptProperties().getProperty('NETLIFY_FUNCTION_URL');
  
  if (!NETLIFY_FUNCTION_URL) {
    Logger.log('❌ NETLIFY_FUNCTION_URL nicht konfiguriert!');
    Logger.log('➡️ Bitte setup() ausführen');
    return;
  }
  
  Logger.log('🔍 Teste Verbindung zu: ' + NETLIFY_FUNCTION_URL);
  
  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ test: true }),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(NETLIFY_FUNCTION_URL, options);
    const code = response.getResponseCode();
    
    if (code === 200 || code === 400) { // 400 ist OK (fehlende Parameter)
      Logger.log('✅ Netlify Function erreichbar!');
      Logger.log('Response Code: ' + code);
    } else {
      Logger.log('⚠️ Unerwarteter Response Code: ' + code);
      Logger.log('Response: ' + response.getContentText());
    }
    
  } catch (e) {
    Logger.log('❌ Verbindung fehlgeschlagen: ' + e.toString());
  }
}

// ============================================================================
// ENDE
// ============================================================================

/**
 * VERWENDUNG:
 * 
 * 1. Setup ausführen:
 *    - Funktion 'setup' im Dropdown auswählen
 *    - Vorher Werte in Zeilen 22, 27, 31 anpassen!
 *    - "Ausführen" klicken
 *    - Log checken: sollte "Setup erfolgreich" zeigen
 * 
 * 2. Test ausführen:
 *    - Video in Google Drive hochladen
 *    - Funktion 'testWithExistingVideo' ausführen
 *    - Video-ID eingeben
 *    - Warten (2-5 Minuten)
 *    - Email und Google Doc checken!
 * 
 * 3. Automatisierung (optional):
 *    - Trigger einrichten für automatische Verarbeitung
 *    - Oder manuell processNewVideo('FILE-ID') aufrufen
 * 
 * SUPPORT:
 * Bei Problemen: Log checken (Ansicht → Logs)
 * oder showSettings() ausführen
 */
