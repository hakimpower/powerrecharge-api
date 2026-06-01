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
function isDevisSigne(body) {
  var statut = (body.status || body.statut || body.state || '').toLowerCase();
  var signed  = body.signed_at || body.signature_date || body.electronic_signature_date || body.date_signature;
  
  // Accepter si statut contient "sign" ou "accept" ou "command" ou "valid"
  if (statut && (
    statut.includes('sign') ||
    statut.includes('accept') ||
    statut.includes('command') ||
    statut.includes('valid') ||
    statut.includes('won')
  )) return true;
  
  // Accepter si une date de signature existe
  if (signed) return true;
  
  // Accepter si envoye depuis Zapier (deja filtre par Zapier)
  if (body.from_zapier) return true;
  
  return false;
}

var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '4.0'}));
    return;
  }

  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Webhook recu:', JSON.stringify(body).slice(0, 800));

      // Verifier si devis signe (sauf si test)
      if (!body.test && !isDevisSigne(body)) {
        console.log('Devis non signe - ignore. Statut:', body.status || body.statut);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, message: 'Devis non signe - ignore'}));
        return;
      }

      // Extraire les infos client depuis toutes les sources possibles
      var company  = body.company  || body.customer || body.client || body.entreprise || {};
      var contact  = body.contact  || body.interlocutor || {};
      var billing  = body.billing_address || body.adresse_facturation || {};
      var quotation = body.quotation || body;

      if (typeof company === 'string') company = {name: company};
      if (typeof contact === 'string') contact = {name: contact};

      var cp = company.zipcode || company.zip || company.postal_code || company.code_postal
            || billing.zipcode || billing.zip || body.cp || body.zipcode || '';

      var dossier = {
        // Infos client
        client:   company.name || company.nom
               || (contact.firstname && contact.lastname ? contact.firstname + ' ' + contact.lastname : '')
               || contact.name || contact.nom
               || body.client || body.company_name || body.customer_name
               || quotation.title || 'Client Axonaut',

        tel:      company.phone || company.telephone || company.mobile || company.tel
               || contact.phone || contact.telephone || contact.mobile
               || body.tel || body.phone || body.telephone || '',

        email:    company.email || contact.email
               || body.email || body.mail || '',

        adresse:  company.address || company.adresse || company.address_line1
               || company.rue || billing.address || billing.street
               || body.adresse || body.address || '',

        ville:    company.city || company.ville
               || billing.city || billing.ville
               || body.ville || body.city || '',

        cp:       String(cp),
        dept:     cp ? String(cp).slice(0, 2) : '',

        // Infos devis
        borne:    quotation.title || quotation.subject || quotation.name
               || body.borne || body.title || '',

        montant:  Number(quotation.total_without_taxes || quotation.montant_ht
               || quotation.amount_ht || quotation.total
               || body.montant || body.amount || body.total || 0),

        ref:      body.ref || ('AX-' + (body.id || quotation.id || Date.now())),

        commercial: (quotation.user && quotation.user.name)
                 || body.commercial || body.user_name || body.salesperson || '',

        datesign: body.datesign || body.signed_at || body.signature_date
               || body.electronic_signature_date || body.date_signature
               || new Date().toLocaleDateString('fr-FR'),

        commentaire: quotation.comment || quotation.notes || quotation.description
                  || body.commentaire || body.comment || body.notes || '',

        // Statuts
        statut:       'new',
        installateur: null,
        rdv:          null,
        notes:        '',
        imported:     false,
        createdAt:    new Date().toISOString()
      };

      console.log('Dossier:', dossier.client, '|', dossier.ville, '|', dossier.tel, '|', dossier.email);

      return firebasePost('/commandes_axonaut.json', dossier).then(function(result) {
        console.log('Firebase OK');
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true, client: dossier.client}));
      });

    }).catch(function(err) {
      console.error('Erreur:', err.message);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: err.message}));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v4 demarree sur port', PORT);
});
