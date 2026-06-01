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
    req.on('data', function(c){ body += c; });
    req.on('end', function(){
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
  });
}

// Verifier si le devis est signe
// Axonaut envoie topic "quotation.updated.customerAnswer" quand le client signe
function isDevisSigne(body, quotation) {
  var topic   = (body.topic || '').toLowerCase();
  var statut  = (quotation.status || '').toLowerCase();
  var sigDate = quotation.electronic_signature_date;

  console.log('Topic:', topic, '| Statut:', statut, '| Signature:', JSON.stringify(sigDate));

  // Topic de reponse client = signature
  if (topic.includes('customeranswer') || topic.includes('customer_answer')) return true;

  // Statut accepte/signe
  if (statut === 'accepted' || statut === 'signed' || statut === 'won' ||
      statut === 'command'  || statut === 'commande') return true;

  // Date de signature electronique presente et non nulle
  if (sigDate && sigDate !== null && sigDate !== 'null') {
    if (typeof sigDate === 'object' && sigDate.date) return true;
    if (typeof sigDate === 'string' && sigDate.length > 5) return true;
  }

  // Envoye depuis test manuel (reqbin)
  if (body.signed_at || body.test) return true;

  return false;
}

var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '5.0'}));
    return;
  }

  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Webhook recu - topic:', body.topic, '| raw:', JSON.stringify(body).slice(0, 600));

      // Axonaut envoie les donnees dans body.data
      var quotation = body.data || body;
      var company   = quotation.company || {};

      // Recuperer l'ID entreprise pour aller chercher les infos client
      var companyId   = quotation.company_id;
      var companyName = quotation.company_name || company.name || '';

      console.log('Company ID:', companyId, '| Company Name:', companyName);

      // Verifier si signe
      if (!isDevisSigne(body, quotation)) {
        console.log('Devis non signe - ignore. Statut:', quotation.status);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, message: 'Devis non signe - ignore'}));
        return;
      }

      console.log('Devis signe - creation du dossier!');

      // Recuperer les infos entreprise depuis Axonaut
      var fetchCompany = companyId
        ? new Promise(function(resolve) {
            var options = {
              hostname: 'app.axonaut.com',
              path: '/api/v1/companies/' + companyId,
              method: 'GET',
              headers: {'apiKey': '619080bd85898f22780e9d463e107e8ac30647619080'}
            };
            var req2 = https.request(options, function(res2) {
              var d = '';
              res2.on('data', function(c){ d += c; });
              res2.on('end', function(){
                try { resolve(JSON.parse(d)); }
                catch(e) { resolve({}); }
              });
            });
            req2.on('error', function(){ resolve({}); });
            req2.setTimeout(8000, function(){ req2.destroy(); resolve({}); });
            req2.end();
          })
        : Promise.resolve({});

      fetchCompany.then(function(companyData) {
        console.log('Entreprise Axonaut:', JSON.stringify(companyData).slice(0, 400));

        var c  = companyData || {};
        var cp = c.zipcode || c.zip_code || c.postal_code || body.cp || '';

        // Extraire signature date
        var sigDate = quotation.electronic_signature_date;
        var sigStr  = '';
        if (sigDate && typeof sigDate === 'object' && sigDate.date) {
          sigStr = sigDate.date.slice(0, 10);
        } else if (sigDate && typeof sigDate === 'string') {
          sigStr = sigDate.slice(0, 10);
        }

        var dossier = {
          client:      c.name || companyName || 'Client Axonaut',
          tel:         c.phone || c.mobile || c.telephone || '',
          email:       c.email || '',
          adresse:     c.address || c.address_line1 || c.street || '',
          ville:       c.city || c.ville || '',
          cp:          String(cp),
          dept:        cp ? String(cp).slice(0, 2) : '',
          borne:       quotation.title || quotation.subject || '',
          montant:     Number(quotation.total_amount || quotation.total_without_taxes || quotation.pre_tax_amount || 0),
          ref:         'AX-' + (quotation.number || quotation.id || Date.now()),
          commercial:  String(quotation.user_id || ''),
          datesign:    sigStr || new Date().toLocaleDateString('fr-FR'),
          commentaire: quotation.comments || quotation.comment || '',
          statut:      'new',
          installateur: null,
          rdv:          null,
          notes:        '',
          imported:     false,
          createdAt:    new Date().toISOString()
        };

        console.log('Dossier final:', dossier.client, '|', dossier.ville, '|', dossier.tel, '|', dossier.borne);

        return firebasePost('/commandes_axonaut.json', dossier);
      }).then(function(result) {
        console.log('Firebase OK:', result);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true}));
      }).catch(function(err) {
        console.error('Erreur:', err.message);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: err.message}));
      });

    }).catch(function(err) {
      console.error('Parse error:', err.message);
      res.writeHead(200);
      res.end(JSON.stringify({error: err.message}));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v5 demarree sur port', PORT);
});
