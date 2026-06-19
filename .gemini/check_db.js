const https = require('https');

function getRecords() {
  const url = 'https://firestore.googleapis.com/v1/projects/niskaram-tracker/databases/(default)/documents/records?pageSize=100';
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.documents) {
          console.log(`Found ${json.documents.length} records.`);
          json.documents.forEach(doc => {
            const name = doc.name;
            const fields = doc.fields;
            const keys = Object.keys(fields);
            const studentId = fields.studentId ? fields.studentId.stringValue : 'MISSING';
            const classId = fields.classId ? fields.classId.stringValue : 'MISSING';
            const madrasaId = fields.madrasaId ? fields.madrasaId.stringValue : 'MISSING';
            const date = fields.date ? fields.date.stringValue : 'MISSING';
            console.log(`Doc: ${name.split('/').pop()} | Date: ${date} | Student: ${studentId} | Class: ${classId} | Madrasa: ${madrasaId}`);
          });
        } else {
          console.log('No documents or error:', json);
        }
      } catch (e) {
        console.error('Parsing error:', e, data);
      }
    });
  }).on('error', (err) => {
    console.error('HTTP error:', err);
  });
}

getRecords();
