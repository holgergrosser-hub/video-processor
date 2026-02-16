// INSTALLATION:
// 1. In Google Apps Script erstellen
// 2. NETLIFY_FUNCTION_URL in Script Properties setzen
// 3. Trigger einrichten: onFileAdded() bei neuen Dateien in Ordner

const NETLIFY_FUNCTION_URL = PropertiesService.getScriptProperties().getProperty('NETLIFY_FUNCTION_URL');
const VIDEO_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('VIDEO_FOLDER_ID');
const OUTPUT_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('OUTPUT_FOLDER_ID');

/**
 * Hauptfunktion: Wird getriggert wenn Video hochgeladen wird
 */
function processNewVideo(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();
    
    // Nur Videos verarbeiten
    if (!mimeType.includes('video')) {
      Logger.log('Keine Video-Datei: ' + mimeType);
      return;
    }
    
    Logger.log('Verarbeite Video: ' + file.getName());
    
    // 1. Video-URL erstellen (öffentlich teilbar)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const videoUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    // 2. Netlify Function aufrufen
    const result = callVideoProcessor(videoUrl, fileId);
    
    if (!result.success) {
      throw new Error('Video-Verarbeitung fehlgeschlagen: ' + result.error);
    }
    
    // 3. Prozessdokumentation erstellen
    const docId = createProcessDocumentation(file.getName(), result);
    
    // 4. Screenshots in Drive speichern
    const screenshotFolderId = saveScreenshots(fileId, result.screenshots);
    
    // 5. Email-Benachrichtigung
    sendNotification(file.getName(), docId, screenshotFolderId);
    
    Logger.log('Fertig! Dokumentation: ' + docId);
    
  } catch (error) {
    Logger.log('Fehler: ' + error.toString());
    // Optional: Email bei Fehler
    sendErrorNotification(error);
  }
}

/**
 * Ruft die Netlify Function auf
 */
function callVideoProcessor(videoUrl, fileId) {
  const payload = {
    videoUrl: videoUrl,
    driveFileId: fileId,
    sensitivity: 0.15  // Empfindlichkeit für Szenenwechsel
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  Logger.log('Rufe Netlify Function auf...');
  const response = UrlFetchApp.fetch(NETLIFY_FUNCTION_URL, options);
  const responseCode = response.getResponseCode();
  
  if (responseCode !== 200) {
    throw new Error('HTTP ' + responseCode + ': ' + response.getContentText());
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * Erstellt Google Doc mit Prozessdokumentation
 */
function createProcessDocumentation(videoName, result) {
  const docName = `Prozessdokumentation - ${videoName.replace('.mp4', '')}`;
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();
  
  // Titel
  body.appendParagraph(docName)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  
  body.appendParagraph(`Erstellt: ${new Date().toLocaleDateString('de-DE')}`)
    .setFontSize(10)
    .setItalic(true);
  
  body.appendHorizontalRule();
  
  // Übersicht
  body.appendParagraph('Übersicht')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  
  body.appendParagraph(`Anzahl Screenshots: ${result.totalScreenshots}`);
  body.appendParagraph(`Video-ID: ${result.videoId}`);
  
  // Transkript-Zusammenfassung (wenn vorhanden)
  if (result.transcript && result.transcript.fullText) {
    body.appendParagraph('')
      .appendText('Vollständiges Transkript:')
      .setBold(true);
    body.appendParagraph(result.transcript.fullText)
      .setFontSize(9)
      .setFontFamily('Courier New');
  }
  
  body.appendPageBreak();
  
  // Screenshots mit Timestamps
  body.appendParagraph('Prozess-Schritte')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  
  result.screenshots.forEach((screenshot, index) => {
    // Schritt-Nummer
    body.appendParagraph(`Schritt ${index + 1}`)
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);
    
    // Timestamp
    const timestamp = formatTimestamp(screenshot.timestamp);
    body.appendParagraph(`Zeitstempel: ${timestamp}`)
      .setFontSize(9)
      .setItalic(true);
    
    // Screenshot einfügen
    try {
      const imageBlob = Utilities.newBlob(
        Utilities.base64Decode(screenshot.base64),
        'image/png',
        screenshot.filename
      );
      
      const image = body.appendImage(imageBlob);
      image.setWidth(500);  // Skalieren auf 500px Breite
      
    } catch (e) {
      body.appendParagraph(`[Fehler beim Laden des Bildes: ${e.toString()}]`)
        .setItalic(true);
    }
    
    // Transkript für diesen Zeitpunkt (wenn vorhanden)
    if (result.transcript && result.transcript.timestamped) {
      const relevantTranscript = findRelevantTranscript(
        screenshot.timestamp,
        result.transcript.timestamped
      );
      
      if (relevantTranscript) {
        body.appendParagraph('')
          .appendText('Erklärung: ')
          .setBold(true)
          .getParent()
          .appendText(relevantTranscript.text);
      }
    }
    
    body.appendParagraph(''); // Leerzeile
    body.appendHorizontalRule();
  });
  
  // Dokument in Output-Ordner verschieben
  const docFile = DriveApp.getFileById(doc.getId());
  const outputFolder = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  outputFolder.addFile(docFile);
  DriveApp.getRootFolder().removeFile(docFile);
  
  return doc.getId();
}

/**
 * Speichert Screenshots in Drive
 */
function saveScreenshots(videoFileId, screenshots) {
  const videoFile = DriveApp.getFileById(videoFileId);
  const folderName = `Screenshots - ${videoFile.getName().replace('.mp4', '')}`;
  
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
 * Findet das relevante Transkript für einen Screenshot-Timestamp
 */
function findRelevantTranscript(screenshotFrame, transcripts) {
  if (!transcripts || transcripts.length === 0) return null;
  
  // Einfache Zuordnung: nimm das zeitlich nächste Transkript
  // TODO: Verbessern mit genauerer Timestamp-Zuordnung
  const index = Math.min(screenshotFrame, transcripts.length - 1);
  return transcripts[index];
}

/**
 * Formatiert Frame-Nummer zu lesbarem Timestamp
 */
function formatTimestamp(frameNumber) {
  // Annahme: 30fps, also Frame / 30 = Sekunden
  const seconds = Math.floor(frameNumber / 30);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Benachrichtigung per Email
 */
function sendNotification(videoName, docId, folderId) {
  const recipient = Session.getActiveUser().getEmail();
  const subject = `Prozessdokumentation fertig: ${videoName}`;
  
  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  
  const body = `
Hallo,

die automatische Prozessdokumentation für "${videoName}" ist fertig!

📄 Dokumentation: ${docUrl}
📁 Screenshots: ${folderUrl}

Viel Erfolg mit deinem Audit-Bericht!

--
Automatisch erstellt von deinem Video-Prozessor
  `;
  
  MailApp.sendEmail(recipient, subject, body);
}

/**
 * Fehler-Benachrichtigung
 */
function sendErrorNotification(error) {
  const recipient = Session.getActiveUser().getEmail();
  const subject = 'Fehler bei Video-Verarbeitung';
  const body = `Fehler: ${error.toString()}`;
  
  MailApp.sendEmail(recipient, subject, body);
}

/**
 * Setup-Funktion: Einmalig ausführen
 */
function setup() {
  // Script Properties setzen
  const ui = SpreadsheetApp.getUi();
  
  const netlfiyUrl = ui.prompt(
    'Netlify Function URL',
    'z.B. https://deine-app.netlify.app/.netlify/functions/process-video',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (netlfiyUrl.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties()
      .setProperty('NETLIFY_FUNCTION_URL', netlfiyUrl.getResponseText());
  }
  
  // Ordner-IDs setzen
  const videoFolderId = ui.prompt(
    'Video-Ordner ID',
    'ID des Ordners wo Videos hochgeladen werden',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (videoFolderId.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties()
      .setProperty('VIDEO_FOLDER_ID', videoFolderId.getResponseText());
  }
  
  const outputFolderId = ui.prompt(
    'Output-Ordner ID',
    'ID des Ordners für Dokumentationen',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (outputFolderId.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties()
      .setProperty('OUTPUT_FOLDER_ID', outputFolderId.getResponseText());
  }
  
  ui.alert('Setup abgeschlossen! Jetzt kannst du Trigger einrichten.');
}

/**
 * Test-Funktion
 */
function testWithExistingVideo() {
  const testFileId = Browser.inputBox('Gib eine Video-Datei-ID zum Testen ein:');
  if (testFileId) {
    processNewVideo(testFileId);
  }
}
