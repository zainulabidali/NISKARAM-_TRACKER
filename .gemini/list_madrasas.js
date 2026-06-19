const https = require('https');

function listMadrasas() {
  const url = 'https://firestore.googleapis.com/v1/projects/niskaram-tracker/databases/(default)/documents/madrasas';
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.documents) {
          console.log('Madrasas:');
          json.documents.forEach(doc => {
            console.log(`ID: ${doc.name.split('/').pop()} | Name: ${doc.fields.name.stringValue}`);
          });
        } else {
          console.log('Response:', json);
        }
      } catch (e) {
        console.error('Error:', e, data);
      }
    });
  });
}

listMadrasas();
