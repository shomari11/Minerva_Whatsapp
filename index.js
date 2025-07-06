const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode  = require('qrcode-terminal');


const MONGO_URI = "mongodb+srv://admin:iPPgoPwwcqo472xN@cf-test.gfnjq.mongodb.net/hsse-hackathon?retryWrites=true&w=majority&appName=hsse-hackathon";
const mongoClient = new MongoClient(MONGO_URI);
let reportsCollection;

mongoClient.connect()
  .then(() => {
    const db = mongoClient.db("hsse-hackathon");
    reportsCollection = db.collection("reports");
    console.log("Connected to Database");
  })
  .catch(err => console.error(" Database Connection Error:", err));



const app = express();
const PORT = process.env.PORT || 3000;
const MEDIA_DIR = path.join(__dirname, 'public/media');







app.listen(PORT, () => {
  console.log(` Media server running on port ${PORT}.`);
  console.log(` Access files at http://localhost:${PORT}/media/<filename>`);
});


const client = new Client({
  authStrategy: new LocalAuth()
});

client.once('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('LInk Phone By Scanning QR Code');
});

client.once('ready', () => {
  console.log(' Phone Has Been Linked.');
});


let sessions = {};
try {
  sessions = JSON.parse(fs.readFileSync('sessions.json'));
} catch {
  sessions = {};
}
function saveSessions() {
  fs.writeFileSync('sessions.json', JSON.stringify(sessions, null, 2));
}


client.on('message', async msg => {
  const id  = msg.from;

  const raw  = msg.body ? msg.body.trim().toLowerCase() : '';
  const text = raw.replace(/['"“”]/g, '');
  const sess = sessions[id] || { step: 'idle', data: {} };


  if (sess.step === 'idle' && text === 'report') {
    sess.step = 'date';
    await client.sendMessage(id, 'Enter the date of the incident (DD-MM-YYYY):');
  }

  else if (sess.step === 'date') {
    sess.data.date = msg.body.trim();
    sess.step = 'time';
    await client.sendMessage(id, ' What time did it happen? (HH:MM)');
  }

  else if (sess.step === 'time') {
    sess.data.time = msg.body.trim();
    sess.step = 'location';
    await client.sendMessage(id,'Please share the incident location using WhatsApp’s “Attach → Location” feature.');
  }

  else if (sess.step === 'location') {
  if (msg.location) {
    // They sent a live location pin
    const { latitude, longitude, name, address } = msg.location;
    sess.data.location = { latitude, longitude, name, address };
    sess.step = 'dets';
    await client.sendMessage(id, 'Got it! Now please state the details of the incident.');
  } else {
    // Fallback if they type text instead
    sess.data.location = msg.body.trim();
    sess.step = 'dets';
    await client.sendMessage(id, 'Thanks—please now state the details of the incident.');
  }
}

  else if (sess.step === 'dets') {
    sess.data.dets = msg.body.trim();
    sess.step = 'anon';
    await client.sendMessage(id, 'Do you want to remain anonymous? (yes/no)');
  }
  

  else if (sess.step === 'anon') {
    const anon = text === 'yes';
    sess.data.anonymous = anon;
    if (!anon) {
      sess.step = 'reporter_name';
      await client.sendMessage(id, 'Please provide your name:');
    } else {
      sess.step = 'media';
      await client.sendMessage(id, 'Please send photo or video evidence now.');
    }
  }

  else if (sess.step === 'reporter_name') {
    sess.data.reporter = { name: msg.body.trim() };
    sess.step = 'reporter_contact';
    await client.sendMessage(id, 'And your contact info (email or phone)?');
  }

  else if (sess.step === 'reporter_contact') {
    sess.data.reporter.contact = msg.body.trim();
    sess.step = 'media';
    await client.sendMessage(id, 'Thanks! Now please send the photo or video evidence.');
  }


  else if (sess.step === 'media' && msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      const ext  = media.mimetype.split('/')[1].split(';')[0];
      const safeId = id.replace(/[^0-9]/g, '');
      const filename = `${Date.now()}_${safeId}.${ext}`;
      const filepath = path.join(MEDIA_DIR, filename);

      fs.writeFileSync(filepath, media.data, 'base64');

      const host = process.env.HOSTNAME || `http://localhost:${PORT}`;
      const publicUrl = `${host}/media/${filename}`;



    const reportDoc = {
      publicId: uuidv4().replace(/-/g,'').slice(0,24),
      date:        sess.data.date,
      time:        sess.data.time,
      location:    sess.data.location,       
      anonymous:   sess.data.anonymous,
      reporter:    sess.data.anonymous ? null : sess.data.reporter, 
      details:     sess.data.dets,
      evidence:    {
        path: sess.data.mediaPath,
        url:  sess.data.mediaUrl
      },
      createdAt:   new Date(),
      source: 'Whatsapp'
    };



    const result = await reportsCollection.insertOne(reportDoc);
    console.log("Inserted report with _id:", result.insertedId);


     let summary = `Report received!\n• Date: ${sess.data.date}\n• Time: ${sess.data.time}\n`;
      if (typeof sess.data.location === 'object') {
          summary += `• Location: ${sess.data.location.name || ''} (${sess.data.location.latitude}, ${sess.data.location.longitude})\n`;
        } else {
          summary += `• Location: ${sess.data.location}\n`;
        }

        summary += `• Detials : ${sess.data.dets}`;

      summary += `• Anonymous: ${sess.data.anonymous}\n`;
      if (!sess.data.anonymous) {
        summary += `• Reporter: ${sess.data.reporter.name} (${sess.data.reporter.contact})\n`;
      }
      summary += `• Evidence ${publicUrl}`;

      await client.sendMessage(id, summary);
      sess.step = 'idle';
    } catch (error) {
      console.error('Error handling media or DB insert:', error);
      await client.sendMessage(id, 'Error saving media. Please try again.');
    }
  }

  else {
    await client.sendMessage(id, 'Welcome to Minerva Whatsapp Incident Reporting System. To Begin Making A Report, Send The Word Report');
  }

  sessions[id] = sess;
  saveSessions();
});


client.initialize();
