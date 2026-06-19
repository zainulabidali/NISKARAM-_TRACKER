const https = require('https');

async function runAudit() {
  const madrasas = [
    "zcQSQuVeVS9Ha3wCcTIH",
    "lk7rVU852PUGDs4ETUtc",
    "lxVXMs2KaOr5VV9C7mGJ",
    "Ou1xYdA0Stf7bTlbSuWI"
  ];

  for (const mId of madrasas) {
    console.log(`Auditing Madrasa: ${mId}`);
    const records = await queryRecords(mId);
    console.log(`  Fetched ${records.length} records.`);
    
    for (const rec of records) {
      const docName = rec.name.split('/').pop();
      const fields = rec.fields || {};
      const classId = fields.classId ? fields.classId.stringValue : undefined;
      const studentId = fields.studentId ? fields.studentId.stringValue : undefined;
      const madrasaId = fields.madrasaId ? fields.madrasaId.stringValue : undefined;
      const date = fields.date ? fields.date.stringValue : undefined;
      
      if (!classId) {
        console.log(`  [ALERT] Doc ${docName} has MISSING classId! Date: ${date}, Student: ${studentId}`);
      }
      if (!madrasaId) {
        console.log(`  [ALERT] Doc ${docName} has MISSING madrasaId! Date: ${date}, Student: ${studentId}`);
      }

      // If we have studentId, verify if the student exists and what their classId is
      if (studentId) {
        const studentInfo = await getStudentInfo(studentId);
        if (!studentInfo) {
          console.log(`  [ALERT] Doc ${docName} has ORPHAN studentId ${studentId} (Student does not exist!)`);
        } else {
          const studentClassId = studentInfo.classId ? studentInfo.classId.stringValue : undefined;
          if (classId !== studentClassId) {
            console.log(`  [ALERT] Doc ${docName} has MISMATCHED classId: record has '${classId}', student profile has '${studentClassId}'`);
          }
        }
      }
    }
  }
  console.log("Audit complete.");
}

function queryRecords(madrasaId) {
  return new Promise((resolve) => {
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

const studentCache = {};
function getStudentInfo(studentId) {
  if (studentCache[studentId] !== undefined) {
    return Promise.resolve(studentCache[studentId]);
  }
  return new Promise((resolve) => {
    const url = `https://firestore.googleapis.com/v1/projects/niskaram-tracker/databases/(default)/documents/students/${studentId}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.fields) {
            studentCache[studentId] = json.fields;
            resolve(json.fields);
          } else {
            studentCache[studentId] = null;
            resolve(null);
          }
        } catch (e) {
          studentCache[studentId] = null;
          resolve(null);
        }
      });
    }).on('error', () => {
      studentCache[studentId] = null;
      resolve(null);
    });
  });
}

runAudit();
