const https = require('https');

async function runAudit() {
  const madrasas = [
    "zcQSQuVeVS9Ha3wCcTIH",
    "lk7rVU852PUGDs4ETUtc",
    "lxVXMs2KaOr5VV9C7mGJ",
    "Ou1xYdA0Stf7bTlbSuWI"
  ];

  for (const mId of madrasas) {
    console.log(`Auditing Students in Madrasa: ${mId}`);
    const students = await queryStudents(mId);
    console.log(`  Fetched ${students.length} students.`);
    
    students.forEach(stu => {
      const docName = stu.name.split('/').pop();
      const fields = stu.fields || {};
      const name = fields.name ? fields.name.stringValue : 'Unnamed';
      const classId = fields.classId ? fields.classId.stringValue : undefined;
      const madrasaId = fields.madrasaId ? fields.madrasaId.stringValue : undefined;
      
      if (!classId) {
        console.log(`  [ALERT] Student ${docName} (${name}) has MISSING classId!`);
      }
      if (!madrasaId) {
        console.log(`  [ALERT] Student ${docName} (${name}) has MISSING madrasaId!`);
      }
    });
  }
  console.log("Student audit complete.");
}

function queryStudents(madrasaId) {
  return new Promise((resolve) => {
    const url = 'https://firestore.googleapis.com/v1/projects/niskaram-tracker/databases/(default)/documents:runQuery';
    const postData = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'students' }],
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
            const docs = [];
            json.forEach(item => {
              if (item.document) docs.push(item.document);
            });
            resolve(docs);
          } else {
            resolve([]);
          }
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.write(postData);
    req.end();
  });
}

runAudit();
