const https = require('https');
const http  = require('http');

const FIREBASE_URL = 'powerrecharge-admin-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_KEY = 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';
const PORT         = process.env.PORT || 3000;

function firebasePost(path, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var options = {
      hostname: FIREBASE_URL,
      path: path + '?auth=' + FIREBASE_KEY,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){ resolve(d); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseBody(req) {
  return new Promise(function(resolve) {
    var body = '';
    req.on('data', function(chunk){ body += chunk; });
    req.on('end', function(){
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
  });
}

var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '2.0'}));
    return;
  }

  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Donnees recues:', JSON.stringify(body).slice(0, 300));

      // Extraire toutes les donnees envoyees par Zapier
      var cp = body.cp || body.company_zipcode || body.zipcode || '';
      var dossier = {
        client:      body.client      || body.company_name      || body.name        || 'Client Axonaut',
        tel:         body.tel         || body.company_phone      || body.phone       || '',
        email:       body.email       || body.company_email      || body.mail        || '',
        adresse:     body.adresse     || body.company_address    || body.address     || '',
        ville:       body.ville       || body.company_city       || body.city        || '',
        cp:          String(cp),
        dept:        cp ? String(cp).slice(0, 2) : '',
        borne:       body.borne       || body.title              || body.subject     || '',
        montant:     Number(body.montant || body.total_without_taxes || body.amount || 0),
        ref:         body.ref         || ('AX-' + (body.id || Date.now())),
        commercial:  body.commercial  || body.user_name          || body.owner       || '',
        datesign:    body.datesign    || body.signed_at          || new Date().toLocaleDateString('fr-FR'),
        commentaire: body.commentaire || body.comment            || body.notes       || '',
        statut:      'new',
        installateur: null,
        rdv:          null,
        notes:        '',
        imported:     false,
        createdAt:    new Date().toISOString()
      };

      console.log('Dossier cree:', dossier.client, dossier.ville, dossier.borne);

      return firebasePost('/commandes_axonaut.json', dossier);
    }).then(function(result) {
      console.log('Firebase OK:', result);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true, message: 'Dossier cree dans Firebase'}));
    }).catch(function(err) {
      console.error('Erreur:', err);
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: err.message}));
    });
    return;
  }

  res.writeHead(404, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v2 demarree sur port', PORT);
});
