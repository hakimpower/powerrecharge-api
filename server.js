const https = require('https');
const http  = require('http');

const FIREBASE_URL = 'powerrecharge-admin-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_KEY = 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';
const PORT         = process.env.PORT || 3000;

// ═══ HELPERS ═══
function stripHtml(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function firebasePost(path, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var options = {
      hostname: FIREBASE_URL,
      path: path + '?auth=' + FIREBASE_KEY,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ resolve(d); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firebasePatch(path, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data);
    var options = {
      hostname: FIREBASE_URL,
      path: path + '?auth=' + FIREBASE_KEY,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    var req = https.request(options, function(res) {
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ resolve(d); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firebaseGet(path) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: FIREBASE_URL,
      path: path + '?auth=' + FIREBASE_KEY,
      method: 'GET'
    };
    var req = https.request(options, function(res) {
      var d = ''; res.on('data', function(c){ d += c; });
      res.on('end', function(){
        try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', reject); req.end();
  });
}

function parseBody(req) {
  return new Promise(function(resolve) {
    var body = '';
    req.on('data', function(c){ body += c; });
    req.on('end', function(){
      try { resolve(JSON.parse(body)); } catch(e) { resolve({}); }
    });
  });
}

// Chercher un dossier existant par email ou ref Axonaut
function findDossierByRef(ref) {
  return firebaseGet('/commandes_axonaut.json').then(function(data) {
    if (!data) return null;
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var d = data[keys[i]];
      if (d && d.ref === ref) return {key: keys[i], data: d};
    }
    return null;
  });
}

function findDossierByEmail(email) {
  return firebaseGet('/commandes_axonaut.json').then(function(data) {
    if (!data || !email) return null;
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var d = data[keys[i]];
      if (d && d.email && d.email.toLowerCase() === email.toLowerCase()) return {key: keys[i], data: d};
    }
    return null;
  });
}

// ═══ SERVER ═══
var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '6.4'}));
    return;
  }

  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var topic     = (body.topic || '').toLowerCase();
      var data      = body.data || body;
      var company   = data.company || {};

      console.log('Topic:', topic, '| ID:', data.id, '| Name:', data.name || data.company_name);

      // ═══════════════════════════════════════
      // TOPIC: company.created ou company.updated
      // Nouveau prospect depuis le formulaire
      // ═══════════════════════════════════════
      if (topic === 'company.created' || topic === 'company.updated') {
        // Ignorer company.created car employees[] est vide a ce stade
        // Seulement traiter company.updated qui contient toutes les infos
        if (topic === 'company.created' && (!data.employees || data.employees.length === 0)) {
          console.log('company.created sans employees - on attend company.updated');
          res.writeHead(200);
          res.end(JSON.stringify({success: true, message: 'En attente company.updated'}));
          return;
        }
        console.log('Company data complet:', JSON.stringify(data).slice(0, 1000));
        // Extraire le contact principal depuis employees[]
        var employees = data.employees || [];
        var mainContact = employees.length > 0 ? employees[0] : {};
        // Nom : company name ou prenom+nom du contact
        var clientName = data.name || '';
        if (!clientName && mainContact.firstname) {
          clientName = (mainContact.firstname + ' ' + (mainContact.lastname || '')).trim();
        }
        var cp      = data.address_zip_code  || data.zipcode    || data.zip_code    || '';
        var tel     = mainContact.cellphone_number || mainContact.phone_number
                   || mainContact.mobile || data.phone || '';
        console.log('Contact trouve:', mainContact.firstname, mainContact.email, tel);
        var email   = mainContact.email       || data.email      || '';
        var adresse = data.address_street     || data.address    || data.street      || '';
        var ville   = data.address_city       || data.city       || data.ville       || '';
        var prospect = {
          client:      clientName || data.name || '',
          tel:         tel,
          email:       email,
          adresse:     adresse,
          ville:       ville,
          cp:          String(cp),
          dept:        cp ? String(cp).slice(0, 2) : '',
          borne:       '',
          montant:     0,
          ref:         'PROSPECT-' + data.id,
          axonautId:   String(data.id || ''),
          statut:      'prospect', // Toujours prospect pour company.created/updated
          installateur: null,
          rdv:          null,
          notes:        '',
          imported:     false,
          createdAt:    new Date().toISOString(),
          updatedAt:    new Date().toISOString()
        };

        console.log('Prospect:', prospect.client, '|', prospect.ville, '|', prospect.tel);

        // Verifier si prospect existe deja
        return findDossierByEmail(prospect.email).then(function(existing) {
          if (existing && topic === 'company.updated') {
            // Mettre a jour le prospect existant
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', {
              client:  prospect.client,
              tel:     prospect.tel,
              email:   prospect.email,
              adresse: prospect.adresse,
              ville:   prospect.ville,
              cp:      prospect.cp,
              dept:    prospect.dept,
              updatedAt: new Date().toISOString()
            }).then(function() {
              console.log('Prospect mis a jour:', prospect.client);
              res.writeHead(200, {'Content-Type': 'application/json'});
              res.end(JSON.stringify({success: true, action: 'updated'}));
            });
          } else if (!existing) {
            // Creer nouveau prospect
            return firebasePost('/commandes_axonaut.json', prospect).then(function() {
              console.log('Prospect cree:', prospect.client);
              res.writeHead(200, {'Content-Type': 'application/json'});
              res.end(JSON.stringify({success: true, action: 'created'}));
            });
          } else {
            console.log('Prospect deja existant - ignore');
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true, action: 'skipped'}));
          }
        });
      }

      // ═══════════════════════════════════════
      // TOPIC: quotation.created
      // Nouveau devis cree dans Axonaut
      // ═══════════════════════════════════════
      if (topic === 'quotation.created') {
        var email     = (data.company && data.company.email) || data.company_email || '';
        var companyName = data.company_name || (data.company && data.company.name) || '';
        var cp2 = (data.company && data.company.zipcode) || '';
        var borneTxt  = stripHtml(data.title || data.subject || 'Devis en cours');
        var devisNum  = data.number || data.id || '';

        // Nettoyer le titre
        if (borneTxt.startsWith(String(devisNum))) {
          borneTxt = borneTxt.slice(String(devisNum).length).trim();
        }
        if (!borneTxt || borneTxt.length < 2) borneTxt = 'Devis en cours';

        // Chercher prospect existant par email
        return findDossierByEmail(email).then(function(existing) {
          if (existing) {
            // Mettre a jour le dossier existant avec infos devis
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', {
              borne:     borneTxt,
              ref:       'AX-' + devisNum,
              statut:    'prospect',
              montant:   Number(data.pre_tax_amount || data.total_amount || 0),
              updatedAt: new Date().toISOString()
            }).then(function() {
              console.log('Dossier mis a jour avec devis:', borneTxt);
              res.writeHead(200, {'Content-Type': 'application/json'});
              res.end(JSON.stringify({success: true, action: 'devis_updated'}));
            });
          } else {
            // Creer nouveau dossier
            var newDossier = {
              client:      companyName,
              tel:         (data.company && data.company.phone) || '',
              email:       email,
              adresse:     (data.company && data.company.address) || '',
              ville:       (data.company && data.company.city) || '',
              cp:          String(cp2),
              dept:        cp2 ? String(cp2).slice(0, 2) : '',
              borne:       borneTxt,
              montant:     Number(data.pre_tax_amount || data.total_amount || 0),
              ref:         'AX-' + devisNum,
              commercial:  String(data.user_id || ''),
              datesign:    '',
              commentaire: stripHtml(data.comments || ''),
              statut:      'prospect', // Toujours prospect pour company.created/updated
              installateur: null,
              rdv:          null,
              notes:        '',
              imported:     false,
              createdAt:    new Date().toISOString(),
              updatedAt:    new Date().toISOString()
            };
            return firebasePost('/commandes_axonaut.json', newDossier).then(function() {
              console.log('Dossier cree depuis devis:', newDossier.client);
              res.writeHead(200, {'Content-Type': 'application/json'});
              res.end(JSON.stringify({success: true, action: 'created'}));
            });
          }
        });
      }

      // ═══════════════════════════════════════
      // TOPIC: quotation.updated ou quotation.updated.customerAnswer
      // Mise a jour devis ou signature client
      // ═══════════════════════════════════════
      if (topic.includes('quotation.updated')) {
        var statut   = (data.status || '').toLowerCase();
        var sigDate  = data.electronic_signature_date;
        var isSigned = statut === 'accepted' || statut === 'signed' || statut === 'won'
                    || (sigDate && sigDate !== null);

        var devisNum2 = data.number || data.id || '';
        var ref2      = 'AX-' + devisNum2;
        var borneTxt2 = stripHtml(data.title || data.subject || '');
        if (borneTxt2.startsWith(String(devisNum2))) borneTxt2 = borneTxt2.slice(String(devisNum2).length).trim();
        if (!borneTxt2 || borneTxt2.length < 2) borneTxt2 = 'Borne a definir';

        var sigStr = '';
        if (sigDate && typeof sigDate === 'object' && sigDate.date) sigStr = sigDate.date.slice(0, 10);
        else if (sigDate && typeof sigDate === 'string') sigStr = sigDate.slice(0, 10);

        var email2 = (data.company && data.company.email) || data.company_email || '';
        var montant2 = Number(data.total_amount || data.pre_tax_amount || 0);

        // Chercher par ref ou email
        return findDossierByRef(ref2).then(function(existing) {
          if (!existing && email2) return findDossierByEmail(email2);
          return existing;
        }).then(function(existing) {
          var update = {
            borne:     borneTxt2,
            montant:   montant2,
            ref:       ref2,
            statut:    isSigned ? 'new' : 'devis_envoye',
            updatedAt: new Date().toISOString()
          };
          if (isSigned) {
            update.datesign = sigStr || new Date().toLocaleDateString('fr-FR');
          }

          if (existing) {
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', update).then(function() {
              console.log('Dossier mis a jour:', existing.data.client, '| Signe:', isSigned);
              res.writeHead(200, {'Content-Type': 'application/json'});
              res.end(JSON.stringify({success: true, action: isSigned ? 'signed' : 'updated'}));
            });
          } else {
            // Creer si pas trouve
            var companyName2 = data.company_name || (data.company && data.company.name) || 'Client Axonaut';
            var cp3 = (data.company && data.company.zipcode) || '';
            update.client      = companyName2;
            update.tel         = (data.company && data.company.phone) || '';
            update.email       = email2;
            update.adresse     = (data.company && data.company.address) || '';
            update.ville       = (data.company && data.company.city) || '';
            update.cp          = String(cp3);
            update.dept        = cp3 ? String(cp3).slice(0, 2) : '';
            update.commercial  = String(data.user_id || '');
            update.commentaire = stripHtml(data.comments || '');
            update.installateur = null;
            update.rdv          = null;
            update.notes        = '';
            update.imported     = false;
            update.createdAt    = new Date().toISOString();
            return firebasePost('/commandes_axonaut.json', update).then(function() {
              console.log('Dossier cree:', companyName2, '| Signe:', isSigned);
              res.writeHead(200, {'Content-Type': 'application/json'});
              res.end(JSON.stringify({success: true, action: 'created'}));
            });
          }
        });
      }

      // Topic non gere
      console.log('Topic ignore:', topic);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: true, message: 'Topic ignore: ' + topic}));

    }).catch(function(err) {
      console.error('Erreur:', err.message);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: err.message}));
    });
    return;
  }


  // ═══════════════════════════════════════
  // ROUTE: /formulaire-webhook
  // Reçoit les données du formulaire WordPress directement
  // ═══════════════════════════════════════
  if (req.url === '/formulaire-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Formulaire recu:', JSON.stringify(body).slice(0, 500));

      var cp = body.code_postal || body.cp || '';
      var dossier = {
        client:      body.nom_prenom    || body.client || body.name || '',
        tel:         body.telephone     || body.tel    || body.phone || '',
        email:       body.email         || body.mail   || '',
        adresse:     body.adresse       || body.address || '',
        ville:       body.ville         || body.city   || '',
        cp:          String(cp),
        dept:        cp ? String(cp).slice(0, 2) : '',
        borne:       body.borne         || body.type_borne || '',
        type_logement: body.type_logement || '',
        distance:    body.distance      || '',
        gestion:     body.gestion_dynamique || '',
        commentaire: body.remarques     || body.comment || '',
        montant:     0,
        ref:         'FORM-' + Date.now(),
        commercial:  'Formulaire web',
        datesign:    '',
        statut:      'prospect',
        installateur: null,
        rdv:          null,
        notes:        '',
        imported:     false,
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString()
      };

      console.log('Prospect formulaire:', dossier.client, '|', dossier.ville, '|', dossier.tel);

      // Verifier si prospect existe deja par email
      return findDossierByEmail(dossier.email).then(function(existing) {
        if (existing) {
          // Mettre a jour avec les nouvelles infos
          return firebasePatch('/commandes_axonaut/' + existing.key + '.json', {
            tel:     dossier.tel,
            adresse: dossier.adresse,
            ville:   dossier.ville,
            cp:      dossier.cp,
            dept:    dossier.dept,
            borne:   dossier.borne,
            type_logement: dossier.type_logement,
            distance:      dossier.distance,
            gestion:       dossier.gestion,
            commentaire:   dossier.commentaire,
            updatedAt:     new Date().toISOString()
          }).then(function() {
            console.log('Prospect mis a jour depuis formulaire:', dossier.client);
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true, action: 'updated'}));
          });
        } else {
          // Creer nouveau prospect
          return firebasePost('/commandes_axonaut.json', dossier).then(function() {
            console.log('Prospect cree depuis formulaire:', dossier.client);
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true, action: 'created'}));
          });
        }
      });
    }).catch(function(err) {
      console.error('Erreur formulaire:', err.message);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({success: false, error: err.message}));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v6 demarree sur port', PORT);
});
