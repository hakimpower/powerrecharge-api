const https = require('https');
const http  = require('http');

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const AXONAUT_KEY  = '619080bd85898f22780e9d463e107e8ac30647619080';
const FIREBASE_URL = 'powerrecharge-admin-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_KEY = 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';
const PORT         = process.env.PORT || 3000;

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function apiGet(host, path, headers) {
  return new Promise(function(resolve, reject) {
    var options = { hostname: host, path: path, method: 'GET', headers: headers };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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

// ═══════════════════════════════════════
// SERVER
// ═══════════════════════════════════════
var server = http.createServer(function(req, res) {

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '1.0'}));
    return;
  }

  // ═══ POST /axonaut-webhook ═══
  // Zapier appelle cette route quand un devis est signe
  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var quotationId = body.id || body.quotation_id;
      if (!quotationId) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'id manquant'}));
        return;
      }

      console.log('Nouveau devis recu:', quotationId);

      // 1. Recuperer le devis complet depuis Axonaut
      apiGet('app.axonaut.com', '/api/v1/quotations/' + quotationId, {
        'apiKey': AXONAUT_KEY,
        'Content-Type': 'application/json'
      }).then(function(quotation) {
        console.log('Devis Axonaut:', JSON.stringify(quotation).slice(0, 200));

        // 2. Extraire toutes les infos
        var company = quotation.company || quotation.customer || {};
        var contact = quotation.contact || {};
        var address = company.address || quotation.billing_address || {};

        var cp = company.zipcode || company.zip_code || address.zipcode || address.zip || '';
        var ville = company.city || address.city || '';

        // Construire le dossier
        var dossier = {
          client:      company.name || (contact.firstname + ' ' + contact.lastname) || quotation.title || 'Client Axonaut',
          tel:         company.phone || company.mobile || contact.phone || contact.mobile || '',
          email:       company.email || contact.email || '',
          adresse:     company.address_line1 || address.line1 || address.street || company.address || '',
          ville:       ville,
          cp:          cp,
          dept:        cp ? String(cp).slice(0, 2) : '',
          borne:       quotation.title || quotation.subject || quotation.name || '',
          montant:     quotation.total_without_taxes || quotation.amount_ht || quotation.total || 0,
          ref:         'AX-' + quotationId,
          commercial:  quotation.user ? (quotation.user.name || quotation.user.firstname + ' ' + quotation.user.lastname) : '',
          datesign:    quotation.signed_at || quotation.validated_at || quotation.created_at || new Date().toLocaleDateString('fr-FR'),
          commentaire: quotation.comment || quotation.notes || quotation.description || '',
          statut:      'new',
          installateur: null,
          rdv:          null,
          notes:        '',
          imported:     false,
          createdAt:    new Date().toISOString()
        };

        console.log('Dossier a creer:', dossier.client, dossier.ville);

        // 3. Ecrire dans Firebase Realtime Database
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
    });
    return;
  }

  // 404
  res.writeHead(404, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API demarree sur port', PORT);
});
