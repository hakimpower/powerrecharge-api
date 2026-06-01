const https = require('https');
const http  = require('http');

const AXONAUT_KEY  = '619080bd85898f22780e9d463e107e8ac30647619080';
const FIREBASE_URL = 'powerrecharge-admin-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_KEY = 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';
const PORT         = process.env.PORT || 3000;

// ═══ HELPERS ═══
function apiGet(hostname, path, headers) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: hostname,
      path: path,
      method: 'GET',
      headers: headers || {}
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(c){ data += c; });
      res.on('end', function(){
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', function(e){ reject(e); });
    req.setTimeout(10000, function(){ req.destroy(); reject(new Error('timeout')); });
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
    req.on('data', function(c){ body += c; });
    req.on('end', function(){
      try { resolve(JSON.parse(body)); }
      catch(e) { resolve({}); }
    });
  });
}

// ═══ SERVER ═══
var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '3.0'}));
    return;
  }

  // ═══ WEBHOOK PRINCIPAL ═══
  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Webhook recu:', JSON.stringify(body).slice(0, 500));

      var quotationId = body.id || body.quotation_id;
      var projectId   = body.project_id || body.id_projet;

      // Appels paralleles : devis + entreprise si on a les IDs
      var promises = [];

      // 1. Recuperer le devis
      if (quotationId) {
        promises.push(
          apiGet('app.axonaut.com', '/api/v1/quotations/' + quotationId, {'apiKey': AXONAUT_KEY})
          .catch(function(){ return {}; })
        );
      } else {
        promises.push(Promise.resolve({}));
      }

      // 2. Recuperer le projet/client si on a l'ID projet
      if (projectId) {
        promises.push(
          apiGet('app.axonaut.com', '/api/v1/projects/' + projectId, {'apiKey': AXONAUT_KEY})
          .catch(function(){ return {}; })
        );
      } else {
        promises.push(Promise.resolve({}));
      }

      return Promise.all(promises).then(function(results) {
        var quotation = results[0] || {};
        var project   = results[1] || {};

        console.log('Devis:', JSON.stringify(quotation).slice(0,300));
        console.log('Projet:', JSON.stringify(project).slice(0,300));

        // Chercher les infos client dans toutes les sources
        var company = quotation.company || quotation.customer || quotation.client
                   || project.company  || project.customer  || project.client || {};
        var contact = quotation.contact || project.contact || {};
        var address = company.address  || {};

        // Si company est une string, la mettre dans name
        if (typeof company === 'string') { company = {name: company}; }

        // Recuperer l'ID entreprise pour un 3eme appel si necessaire
        var companyId = quotation.company_id || quotation.customer_id
                     || project.company_id   || body.company_id;

        var fetchCompany = companyId
          ? apiGet('app.axonaut.com', '/api/v1/companies/' + companyId, {'apiKey': AXONAUT_KEY}).catch(function(){ return {}; })
          : Promise.resolve({});

        return fetchCompany.then(function(companyData) {
          console.log('Entreprise:', JSON.stringify(companyData).slice(0,300));

          // Fusionner toutes les sources
          var c = companyData || {};
          var cp = c.zipcode || c.zip_code || c.postal_code
                || company.zipcode || company.zip_code
                || body.cp || body.zipcode || '';

          var dossier = {
            client:      c.name || company.name
                      || (contact.firstname + ' ' + contact.lastname).trim()
                      || body.client || quotation.title || 'Client Axonaut',
            tel:         c.phone || c.mobile || c.telephone
                      || company.phone || company.mobile
                      || contact.phone || contact.mobile
                      || body.tel || '',
            email:       c.email || company.email || contact.email
                      || body.email || '',
            adresse:     c.address || c.address_line1 || c.street
                      || company.address || body.adresse || '',
            ville:       c.city || c.ville || company.city
                      || body.ville || '',
            cp:          String(cp),
            dept:        cp ? String(cp).slice(0, 2) : '',
            borne:       quotation.title || quotation.subject || quotation.name
                      || body.borne || '',
            montant:     Number(quotation.total_without_taxes || quotation.amount_ht
                      || quotation.total || body.montant || 0),
            ref:         'AX-' + (quotationId || body.ref || Date.now()),
            commercial:  (quotation.user && (quotation.user.name || quotation.user.firstname + ' ' + quotation.user.lastname))
                      || body.commercial || '',
            datesign:    quotation.signed_at || quotation.validated_at
                      || body.datesign || new Date().toLocaleDateString('fr-FR'),
            commentaire: quotation.comment || quotation.notes || quotation.description
                      || body.commentaire || '',
            statut:      'new',
            installateur: null,
            rdv:          null,
            notes:        '',
            imported:     false,
            createdAt:    new Date().toISOString()
          };

          console.log('Dossier final:', dossier.client, dossier.ville, dossier.tel);
          return firebasePost('/commandes_axonaut.json', dossier);
        });
      });
    }).then(function(result) {
      console.log('Firebase OK:', result);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true}));
    }).catch(function(err) {
      console.error('Erreur:', err.message);
      // Meme en cas d erreur on repond 200 pour que Zapier ne bloque pas
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: err.message}));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v3 demarree sur port', PORT);
});
