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
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
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
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
    };
    var req = https.request(options, function(res) {
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ resolve(d); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firebaseGet(path) {
  return new Promise(function(resolve, reject) {
    var options = {hostname: FIREBASE_URL, path: path + '?auth=' + FIREBASE_KEY, method: 'GET'};
    var req = https.request(options, function(res) {
      var d = ''; res.on('data', function(c){ d += c; });
      res.on('end', function(){ try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    });
    req.on('error', reject); req.end();
  });
}

function parseBody(req) {
  return new Promise(function(resolve) {
    var body = '';
    req.on('data', function(c){ body += c; });
    req.on('end', function(){ try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
  });
}

// Chercher dossier par company_id Axonaut
function findDossierByAxonautId(axonautId) {
  return firebaseGet('/commandes_axonaut.json').then(function(data) {
    if (!data) return null;
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var d = data[keys[i]];
      if (d && d.axonautId && String(d.axonautId) === String(axonautId)) return {key: keys[i], data: d};
    }
    return null;
  });
}

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

// Mise a jour selective - ne jamais ecraser avec des valeurs vides
function selectiveUpdate(existing, newData) {
  var update = {updatedAt: new Date().toISOString()};
  var fields = ['client','tel','email','adresse','ville','cp','dept','borne','montant','ref','commercial','datesign','commentaire','axonautId'];
  fields.forEach(function(f) {
    if (newData[f] !== undefined && newData[f] !== null && newData[f] !== '' && newData[f] !== 0) {
      update[f] = newData[f];
    }
  });
  if (newData.statut) update.statut = newData.statut;
  return update;
}



// Appeler l'API Axonaut pour recuperer les adresses d'une entreprise
function getAxonautAddresses(companyId) {
  return new Promise(function(resolve) {
    var options = {
      hostname: 'app.axonaut.com',
      path: '/api/v1/companies/' + companyId + '/addresses',
      method: 'GET',
      headers: {'apiKey': '619080bd85898f22780e9d463e107e8ac30647619080'}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        try {
          var addresses = JSON.parse(d);
          console.log('Addresses from Axonaut:', JSON.stringify(addresses).slice(0, 300));
          // Chercher l'adresse principale (is_for_quotation ou premiere adresse)
          if (!Array.isArray(addresses) || addresses.length === 0) { resolve({}); return; }
          var main = addresses.find(function(a){ return a.is_for_quotation; }) || addresses[0];
          resolve({
            adresse: main.address_street || main.street || '',
            ville:   main.address_city   || main.city   || '',
            cp:      String(main.address_zip_code || main.zipcode || main.zip_code || '')
          });
        } catch(e) { resolve({}); }
      });
    });
    req.on('error', function(){ resolve({}); });
    req.setTimeout(8000, function(){ req.destroy(); resolve({}); });
    req.end();
  });
}

// Appliquer une adresse en attente apres creation du prospect
function applyPendingAddress(companyId, rdbKey) {
  return firebaseGet('/pending_addresses.json').then(function(data) {
    if (!data) return;
    var keys = Object.keys(data);
    var found = null;
    for (var i = 0; i < keys.length; i++) {
      if (data[keys[i]] && String(data[keys[i]].companyId) === String(companyId)) {
        found = {key: keys[i], data: data[keys[i]]};
        break;
      }
    }
    if (!found) return;
    console.log('Adresse en attente trouvee pour:', companyId, found.data.adresse);
    var addrUpdate = {updatedAt: new Date().toISOString()};
    if (found.data.adresse) addrUpdate.adresse = found.data.adresse;
    if (found.data.ville)   addrUpdate.ville   = found.data.ville;
    if (found.data.cp)      { addrUpdate.cp = found.data.cp; addrUpdate.dept = found.data.dept || found.data.cp.slice(0,2); }
    // Supprimer l'adresse en attente
    return Promise.all([
      firebasePatch('/commandes_axonaut/' + rdbKey + '.json', addrUpdate),
      firebasePatch('/pending_addresses/' + found.key + '.json', {deleted: true})
    ]);
  }).catch(function(e){ console.warn('applyPendingAddress error:', e.message); });
}

// ═══ SERVER ═══
var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '7.6'}));
    return;
  }

  if (req.url === '/axonaut-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var topic = (body.topic || '').toLowerCase();
      var data  = body.data || body;
      console.log('Topic:', topic, '| ID:', data.id, '| Name:', data.name || data.company_name || '');
      console.log('Data:', JSON.stringify(data).slice(0, 600));

      // ═══ COMPANY.CREATED ═══
      // Creer le prospect avec les infos de base
      if (topic === 'company.created') {
        var employees = data.employees || [];
        var contact   = employees.length > 0 ? employees[0] : {};
        if (employees.length === 0) {
          console.log('company.created sans employees - on attend company.updated');
          res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Attente company.updated'}));
          return;
        }
        var prospect = {
          client:    data.name || '',
          tel:       contact.cellphone_number || contact.phone_number || contact.mobile || '',
          email:     contact.email || '',
          adresse:   data.address_street || '',
          ville:     data.address_city || '',
          cp:        String(data.address_zip_code || ''),
          dept:      data.address_zip_code ? String(data.address_zip_code).slice(0,2) : '',
          axonautId: String(data.id),
          statut:    'prospect',
          borne: '', montant: 0, ref: 'PROSPECT-' + data.id,
          installateur: null, rdv: null, notes: '', imported: false,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        console.log('Prospect:', prospect.client, prospect.tel, prospect.email);
        return findDossierByAxonautId(data.id).then(function(existing) {
          if (existing) {
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', selectiveUpdate(existing.data, prospect));
          }
          return firebasePost('/commandes_axonaut.json', prospect);
        }).then(function() {
          res.writeHead(200); res.end(JSON.stringify({success: true}));
        });
      }

      // ═══ COMPANY.UPDATED ═══
      // Mettre a jour les infos client
      if (topic === 'company.updated' || topic === 'company.updated.name') {
        var employees2 = data.employees || [];
        var contact2   = employees2.length > 0 ? employees2[0] : {};
        var tel2   = contact2.cellphone_number || contact2.phone_number || contact2.mobile || '';
        var email2 = contact2.email || '';
        // Appeler l'API Axonaut pour recuperer les adresses automatiquement
        getAxonautAddresses(data.id).then(function(addrData) {
          var update2 = {
            client:    data.name || '',
            tel:       tel2,
            email:     email2,
            adresse:   addrData.adresse || data.address_street || '',
            ville:     addrData.ville   || data.address_city   || '',
            cp:        addrData.cp      || String(data.address_zip_code || ''),
            dept:      (addrData.cp || data.address_zip_code) ? String(addrData.cp || data.address_zip_code).slice(0,2) : '',
            axonautId: String(data.id),
            updatedAt: new Date().toISOString()
          };
          console.log('Company update avec adresse:', update2.client, update2.tel, update2.email, '|', update2.adresse, update2.ville, update2.cp);
          return findDossierByAxonautId(data.id).then(function(existing) {
            if (existing) {
              return firebasePatch('/commandes_axonaut/' + existing.key + '.json', selectiveUpdate(existing.data, update2));
            }
            // Creer si pas trouve
            update2.statut = 'prospect';
            update2.borne = ''; update2.montant = 0; update2.ref = 'PROSPECT-' + data.id;
            update2.installateur = null; update2.rdv = null; update2.notes = '';
            update2.imported = false; update2.createdAt = new Date().toISOString();
            return firebasePost('/commandes_axonaut.json', update2).then(function(result) {
              var resultKey = JSON.parse(result).name;
              return applyPendingAddress(String(data.id), resultKey);
            });
          });
        }).then(function() {
          res.writeHead(200); res.end(JSON.stringify({success: true}));
        }).catch(function(e) {
          console.error('company.updated error:', e.message);
          res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }

      // ═══ ADDRESS.UPDATED ═══
      // Mettre a jour l'adresse du prospect
      if (topic === 'address.updated') {
        console.log('Address data:', JSON.stringify(data));
        // L'ID entreprise est dans data.company.id
        var companyId = (data.company && data.company.id) || data.company_id || data.owner_id || data.entity_id;
        var adresse3  = data.address_street || data.street || data.address || data.line1 || '';
        var ville3    = data.address_city   || data.city   || '';
        var cp3       = String(data.address_zip_code || data.zipcode || data.zip_code || data.postal_code || '');
        console.log('Address parsed - CompanyId:', companyId, '| Rue:', adresse3, '| Ville:', ville3, '| CP:', cp3);
        if (!companyId) {
          res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Pas de company_id'}));
          return;
        }
        findDossierByAxonautId(companyId).then(function(existing) {
          var addrData = {};
          if (adresse3) addrData.adresse = adresse3;
          if (ville3)   addrData.ville   = ville3;
          if (cp3)      { addrData.cp = cp3; addrData.dept = cp3.slice(0,2); }
          addrData.updatedAt = new Date().toISOString();

          if (existing) {
            console.log('Adresse mise a jour:', adresse3, ville3, cp3);
            firebasePatch('/commandes_axonaut/' + existing.key + '.json', addrData).then(function() {
              res.writeHead(200); res.end(JSON.stringify({success: true}));
            }).catch(function(e){ res.writeHead(200); res.end(JSON.stringify({error: e.message})); });
          } else {
            // Prospect pas encore cree - sauvegarder l'adresse en attente
            console.log('Prospect non trouve - adresse en attente pour companyId:', companyId);
            addrData.companyId = String(companyId);
            firebasePost('/pending_addresses.json', addrData).then(function() {
              res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Adresse en attente'}));
            }).catch(function(e){ res.writeHead(200); res.end(JSON.stringify({error: e.message})); });
          }
        }).catch(function(e){ res.writeHead(200); res.end(JSON.stringify({error: e.message})); });
        return;
      }

      // ═══ EMPLOYEE.CREATED / EMPLOYEE.UPDATED ═══
      // Mettre a jour tel et email depuis le contact
      if (topic === 'employee.created' || topic === 'employee.updated') {
        var companyId4 = data.company_id;
        var tel4   = data.cellphone_number || data.phone_number || data.mobile || '';
        var email4 = data.email || '';
        console.log('Employee:', data.firstname, data.lastname, email4, tel4, 'Company:', companyId4);
        if (!companyId4) {
          res.writeHead(200); res.end(JSON.stringify({success: true}));
          return;
        }
        findDossierByAxonautId(companyId4).then(function(existing) {
          if (!existing) {
            res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Prospect non trouve'}));
            return;
          }
          var empUpdate = {updatedAt: new Date().toISOString()};
          if (tel4)   empUpdate.tel   = tel4;
          if (email4) empUpdate.email = email4;
          if (!existing.data.client && data.firstname) {
            empUpdate.client = (data.firstname + ' ' + (data.lastname || '')).trim();
          }
          console.log('Employee update:', empUpdate);
          firebasePatch('/commandes_axonaut/' + existing.key + '.json', empUpdate).then(function() {
            res.writeHead(200); res.end(JSON.stringify({success: true}));
          }).catch(function(e) {
            res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
          });
        }).catch(function(e) {
          res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }

      // ═══ QUOTATION.CREATED ═══
      // Ajouter borne et montant estimé
      if (topic === 'quotation.created') {
        var companyId5  = data.company_id;
        var companyName5 = data.company_name || '';
        var devisNum5   = data.number || data.id || '';
        var borneTxt5   = stripHtml(data.title || data.subject || '');
        if (borneTxt5.startsWith(String(devisNum5))) borneTxt5 = borneTxt5.slice(String(devisNum5).length).trim();
        if (!borneTxt5 || borneTxt5.length < 2) borneTxt5 = 'Borne a definir';
        var montant5 = Number(data.pre_tax_amount || data.total_amount || 0);
        var ref5 = 'AX-' + devisNum5;
        console.log('Quotation created:', companyName5, borneTxt5, montant5);

        return findDossierByAxonautId(companyId5).then(function(existing) {
          var update5 = {
            borne: borneTxt5, ref: ref5,
            statut: 'prospect',
            updatedAt: new Date().toISOString()
          };
          if (montant5) update5.montant = montant5;
          if (existing) {
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', update5);
          }
          // Creer depuis devis si prospect pas encore cree
          update5.client = companyName5; update5.axonautId = String(companyId5 || '');
          update5.tel = ''; update5.email = ''; update5.adresse = ''; update5.ville = ''; update5.cp = ''; update5.dept = '';
          update5.installateur = null; update5.rdv = null; update5.notes = ''; update5.imported = false;
          update5.createdAt = new Date().toISOString();
          return firebasePost('/commandes_axonaut.json', update5);
        }).then(function() {
          res.writeHead(200); res.end(JSON.stringify({success: true}));
        });
      }

      // ═══ QUOTATION.UPDATED ═══
      // Mise a jour devis ou signature
      if (topic.includes('quotation.updated')) {
        var statut6  = (data.status || '').toLowerCase();
        var sigDate6 = data.electronic_signature_date;
        var isSigned = statut6 === 'accepted' || statut6 === 'signed' || statut6 === 'won'
                    || (sigDate6 && sigDate6 !== null && sigDate6 !== 'null');
        var devisNum6 = data.number || data.id || '';
        var ref6 = 'AX-' + devisNum6;
        var borneTxt6 = stripHtml(data.title || data.subject || '');
        if (borneTxt6.startsWith(String(devisNum6))) borneTxt6 = borneTxt6.slice(String(devisNum6).length).trim();
        if (!borneTxt6 || borneTxt6.length < 2) borneTxt6 = '';
        var sigStr6 = '';
        if (sigDate6 && typeof sigDate6 === 'object' && sigDate6.date) sigStr6 = sigDate6.date.slice(0,10);
        else if (sigDate6 && typeof sigDate6 === 'string') sigStr6 = sigDate6.slice(0,10);
        var montant6 = Number(data.total_amount || data.pre_tax_amount || 0);
        var companyId6 = data.company_id;
        console.log('Quotation updated - signe:', isSigned, '| ref:', ref6, '| montant:', montant6);

        return findDossierByAxonautId(companyId6).then(function(existing) {
          if (!existing) return findDossierByRef(ref6);
          return existing;
        }).then(function(existing) {
          var update6 = {
            ref: ref6,
            statut: isSigned ? 'new' : 'prospect',
            updatedAt: new Date().toISOString()
          };
          if (borneTxt6) update6.borne = borneTxt6;
          if (montant6)  update6.montant = montant6;
          if (isSigned && sigStr6) update6.datesign = sigStr6;
          if (existing) {
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', update6);
          }
          // Creer si pas trouve
          update6.client = data.company_name || 'Client Axonaut';
          update6.axonautId = String(companyId6 || '');
          update6.tel = ''; update6.email = ''; update6.adresse = ''; update6.ville = ''; update6.cp = ''; update6.dept = '';
          update6.installateur = null; update6.rdv = null; update6.notes = ''; update6.imported = false;
          update6.createdAt = new Date().toISOString();
          return firebasePost('/commandes_axonaut.json', update6);
        }).then(function() {
          res.writeHead(200); res.end(JSON.stringify({success: true, signed: isSigned}));
        });
      }

      // Topic ignore
      console.log('Topic ignore:', topic);
      res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Ignore: ' + topic}));

    }).catch(function(err) {
      console.error('Erreur:', err.message);
      res.writeHead(200); res.end(JSON.stringify({success: false, error: err.message}));
    });
    return;
  }


  // ═══════════════════════════════════════
  // ROUTE: /formulaire-webhook
  // Recoit les donnees depuis Zapier avec toutes les infos client
  // ═══════════════════════════════════════
  if (req.url === '/formulaire-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Formulaire Zapier recu:', JSON.stringify(body).slice(0, 500));

      var cp = body.cp || body.code_postal || '';
      var axonautId = body.axonautId || body.axonaut_id || '';

      var dossier = {
        client:    body.client    || body.nom_prenom  || body.name || '',
        tel:       body.tel       || body.telephone   || body.phone || '',
        email:     body.email     || body.mail        || '',
        adresse:   body.adresse   || body.address     || '',
        ville:     body.ville     || body.city        || '',
        cp:        String(cp),
        dept:      cp ? String(cp).slice(0, 2) : '',
        borne:     body.borne     || body.title       || '',
        montant:   Number(body.montant || 0),
        ref:       body.ref       || (axonautId ? 'PROSPECT-' + axonautId : 'FORM-' + Date.now()),
        axonautId: String(axonautId),
        commentaire: body.remarques || body.comment || '',
        statut:    'prospect',
        installateur: null, rdv: null, notes: '',
        imported: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      console.log('Prospect depuis Zapier:', dossier.client, '|', dossier.adresse, dossier.ville, dossier.cp, '|', dossier.tel);

      // Chercher par axonautId en priorite, sinon par email
      var findPromise = axonautId
        ? findDossierByAxonautId(axonautId)
        : Promise.resolve(null);

      findPromise.then(function(existing) {
        if (!existing && dossier.email) return findDossierByEmail(dossier.email);
        return existing;
      }).then(function(existing) {
        if (existing) {
          // Mettre a jour avec les nouvelles infos (selective)
          var update = {updatedAt: new Date().toISOString()};
          var fields = ['client','tel','email','adresse','ville','cp','dept','borne','axonautId'];
          fields.forEach(function(f) {
            if (dossier[f] && dossier[f] !== '' && dossier[f] !== '0') update[f] = dossier[f];
          });
          console.log('Mise a jour prospect existant:', existing.data.client);
          firebasePatch('/commandes_axonaut/' + existing.key + '.json', update).then(function() {
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'updated'}));
          }).catch(function(e){ res.writeHead(200); res.end(JSON.stringify({error: e.message})); });
        } else {
          // Creer nouveau prospect
          console.log('Creation nouveau prospect:', dossier.client);
          firebasePost('/commandes_axonaut.json', dossier).then(function() {
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'created'}));
          }).catch(function(e){ res.writeHead(200); res.end(JSON.stringify({error: e.message})); });
        }
      }).catch(function(e) {
        console.error('Erreur formulaire:', e.message);
        res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
      });
    });
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v7 demarree sur port', PORT);
});
