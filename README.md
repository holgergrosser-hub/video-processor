# 🎥 Automatische Prozessdokumentation aus Screen-Recordings

Extrahiert automatisch Screenshots und Transkripte aus Screen-Recording Videos und erstellt daraus eine formatierte Prozessdokumentation in Google Docs.

## 🎯 Was macht das System?

1. **Video hochladen** → Google Drive
2. **Automatische Verarbeitung**:
   - Screenshots bei jedem Szenenwechsel (z.B. neues Fenster, Tab, Dialog)
   - Audio-Transkription mit Timestamps
3. **Google Doc erstellen** mit:
   - Screenshots an den richtigen Stellen
   - Transkript-Text als Erklärungen
   - Professionelle Formatierung
4. **Email-Benachrichtigung** wenn fertig

## 📋 Voraussetzungen

- Google Account (Drive + Apps Script)
- Netlify Account (kostenlos)
- Google Cloud Account (für Transkription, optional)
- GitHub Account (für Deployment)

## 🚀 Installation

### **Teil 1: Netlify Function deployen**

1. **Repository erstellen:**
```bash
cd video-processor
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DEIN-USERNAME/video-processor.git
git push -u origin main
```

2. **Mit Netlify verbinden:**
   - Gehe zu https://app.netlify.com
   - "New site from Git" → GitHub Repository auswählen
   - Build settings:
     - Build command: `npm install && npm run build`
     - Publish directory: `public`
   - Deploy!

3. **Google Cloud Credentials einrichten (für Transkription):**
   
   a) Google Cloud Console öffnen: https://console.cloud.google.com
   
   b) Neues Projekt erstellen: "audit-video-processor"
   
   c) Speech-to-Text API aktivieren:
      - APIs & Services → Library
      - "Cloud Speech-to-Text API" suchen
      - Aktivieren
   
   d) Service Account erstellen:
      - IAM & Admin → Service Accounts
      - "Create Service Account"
      - Name: "video-processor"
      - Role: "Cloud Speech Client"
      - JSON Key erstellen und herunterladen
   
   e) In Netlify Environment Variables setzen:
      - Site Settings → Environment Variables
      - `GOOGLE_APPLICATION_CREDENTIALS_JSON` = [Kompletter JSON-Inhalt]

4. **Deine Function URL kopieren:**
   - Nach Deployment: `https://DEINE-SITE.netlify.app/.netlify/functions/process-video`

### **Teil 2: Google Apps Script einrichten**

1. **Google Drive Ordner erstellen:**
   - Ordner "Audit-Videos" für Video-Uploads
   - Ordner "Prozessdokumentationen" für Outputs
   - Jeweils ID kopieren (aus URL)

2. **Apps Script erstellen:**
   - Google Drive → Neu → Google Apps Script
   - Code aus `google-apps-script/VideoProcessor.gs` einfügen
   - Speichern

3. **Setup ausführen:**
   - Funktion `setup()` ausführen
   - Netlify Function URL eingeben
   - Ordner-IDs eingeben

4. **Trigger einrichten (Optional - für volle Automatisierung):**
   - Triggers → Add Trigger
   - Function: `processNewVideo`
   - Event: "On form submit" ODER manuelle Ausführung
   
   **Alternativ:** Trigger per Google Drive File Watcher
   - Apps Script Projekt mit Google Drive API verbinden
   - Trigger bei neuen Dateien im Video-Ordner

## 🧪 Testen

### **Variante A: Test-Interface (einfach)**

1. Öffne: `https://DEINE-SITE.netlify.app`
2. Video-URL eingeben
3. "Video verarbeiten" klicken
4. Warten (kann 2-5 Minuten dauern)

### **Variante B: Google Apps Script (realistisch)**

1. Video in "Audit-Videos" Ordner hochladen
2. Video-ID kopieren (aus Drive URL)
3. Apps Script öffnen
4. Funktion `testWithExistingVideo()` ausführen
5. Video-ID eingeben

## 📝 Verwendung

### **Automatischer Workflow:**

1. Kunde macht Screen-Recording (z.B. mit OBS, Loom, QuickTime)
2. Video in Google Drive hochladen
3. **System läuft automatisch:**
   - Screenshots extrahieren
   - Audio transkribieren
   - Google Doc erstellen
   - Email senden
4. Du bekommst fertiges Dokument per Email

### **Manueller Workflow:**

```javascript
// In Apps Script Console
processNewVideo('1ABCdef123...'); // Deine Video-ID
```

## ⚙️ Konfiguration

### **Screenshot-Empfindlichkeit anpassen:**

In `VideoProcessor.gs`, Zeile mit `sensitivity`:

```javascript
const payload = {
  videoUrl: videoUrl,
  driveFileId: fileId,
  sensitivity: 0.15  // Hier ändern
};
```

**Werte:**
- `0.1` = Sehr empfindlich (viele Screenshots, jede kleine Änderung)
- `0.15` = **Standard** (gut für Screen-Recordings)
- `0.2` = Weniger empfindlich
- `0.3` = Nur große Änderungen

### **Ohne Transkription (schneller, günstiger):**

Falls du keine Audio-Transkription brauchst:

1. Netlify Environment Variable NICHT setzen
2. System läuft trotzdem, nur ohne Transkript-Teil

## 💰 Kosten

| Service | Kosten | Details |
|---------|--------|---------|
| Netlify Functions | **Kostenlos** | 125.000 Requests/Monat gratis |
| Google Cloud Speech | **~0,10€ pro Stunde Video** | Erste 60 Min/Monat gratis |
| Google Drive/Apps Script | **Kostenlos** | Im Standard-Account enthalten |

**Beispiel:** 10 Videos à 30 Min/Monat = ~3€/Monat

## 🔧 Troubleshooting

### **"Video nicht gefunden"**
- Video in Drive auf "Jeder mit Link" setzen
- URL muss Download-Link sein, nicht View-Link

### **"FFmpeg error"**
- Netlify Function Logs checken
- Video-Format prüfen (MP4, MOV, AVI sollten funktionieren)

### **"Transkription fehlgeschlagen"**
- Google Cloud Credentials prüfen
- Billing in Google Cloud aktiviert?
- Speech-to-Text API aktiviert?

### **Zu viele/wenige Screenshots**
- `sensitivity` Parameter anpassen
- Niedrigerer Wert = mehr Screenshots
- Höherer Wert = weniger Screenshots

### **Function Timeout**
- Netlify Free: 10 Sekunden Limit
- Bei langen Videos: Netlify Pro upgraden (26 Sekunden)
- Oder: Video vorher splitten

## 🎓 Beispiel-Output

Das System erstellt ein Google Doc wie:

```
Prozessdokumentation - Bestellprozess ERP-System
Erstellt: 07.02.2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Übersicht
Anzahl Screenshots: 12
Video-ID: 1ABCdef...

Prozess-Schritte
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Schritt 1
Zeitstempel: 0:05
[Screenshot: ERP Login-Bildschirm]
Erklärung: "Zuerst melde ich mich im ERP-System an..."

Schritt 2
Zeitstempel: 0:32
[Screenshot: Bestellmaske geöffnet]
Erklärung: "Dann navigiere ich zu Einkauf → Neue Bestellung..."

...
```

## 🚀 Erweitungsmöglichkeiten

### **1. Automatische Email an Kunden**
```javascript
// In VideoProcessor.gs ergänzen
function sendToCustomer(docId, customerEmail) {
  const doc = DocumentApp.openById(docId);
  const pdf = doc.getAs('application/pdf');
  
  MailApp.sendEmail({
    to: customerEmail,
    subject: 'Ihre Prozessdokumentation',
    body: 'Anbei die Dokumentation...',
    attachments: [pdf]
  });
}
```

### **2. OCR auf Screenshots**
- Google Cloud Vision API verwenden
- Text aus Screenshots extrahieren
- In Dokumentation ergänzen

### **3. In Audit-Bericht integrieren**
```javascript
// Kombiniere mit deinem bestehenden System
function addProcessDocToAuditReport(auditId, docId) {
  // Screenshots in Audit-Bericht einfügen
}
```

### **4. Mehrsprachigkeit**
```javascript
// In process-video.js
languageCode: 'de-DE',  // Deutsch
languageCode: 'en-US',  // Englisch
languageCode: 'es-ES',  // Spanisch
```

## 📧 Support

Bei Fragen oder Problemen:
- GitHub Issues: [Repository Link]
- Email: holger@qm-guru.de

## 📜 Lizenz

MIT License - Frei verwendbar für deine Audit-Projekte!

---

**Entwickelt für:** QM-Dienstleistungen & OnlineCert.info  
**Von:** Holger Grosser  
**Datum:** Februar 2026
