const https = require('https');

function queryRecords(madrasaId) {
  const url = 'https://firestore.googleapis.com/v1/projects/niskaram-tracker/databases/(default)/documents:runQuery';
  const postData = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'records' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'madrasaId' },
          op: 'EQUAL',
          value: { stringValue: madrasaId }
        }
      }
    }
  });

  const req = https.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': postData.length
    }
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (Array.isArray(json)) {
          console.log(`Madrasa ${madrasaId}: Found ${json.length} records.`);
          let count = 0;
          json.forEach(item => {
            if (item.document) {
              count++;
              const doc = item.document;
              const fields = doc.fields;
              const name = doc.name.split('/').pop();
              const classId = fields.classId ? fields.classId.stringValue : undefined;
              const studentId = fields.studentId ? fields.studentId.stringValue : undefined;
              const date = fields.date ? fields.date.stringValue : undefined;
              const prayers = fields.prayers ? JSON.stringify(fields.prayers) : undefined;
              
              if (!classId || !studentId || !date) {
                console.log(`[ALERT] Invalid Record - Doc: ${name} | Date: ${date} | Student: ${studentId} | Class: ${classId}`);
              } else {
                // Check if classId is actually empty or invalid
                // console.log(`Doc: ${name} | Date: ${date} | Student: ${studentId} | Class: ${classId}`);
              }
            }
          });
          console.log(`Processed ${count} actual documents.`);
        } else {
          console.log(`Response for ${madrasaId}:`, json);
        }
      } catch (e) {
        console.error('Error parsing response:', e, data);
      }
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e);
  });

  req.write(postData);
  req.end();
}

// Query for each known madrasa
const madrasas = [
  "BM0alHHCrdyHeeql5UNJ",
  "NZyHotvMnJnzkR6wQrAQ",
  "Ou1xYdA0Stf7bTlbSuWI",
  "k3JJEcF6LPj73BGwhpm0",
  "lk7rVU852PUGDs4ETUtc",
  "lxVXMs2KaOr5VV9C7mGJ",
  "zcQSQuVeVS9Ha3wCcTIH"
];

madrasas.forEach(queryRecords);
