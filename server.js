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


const FIRESTORE_URL = 'firestore.googleapis.com';
const FIREBASE_PROJECT = 'powerrecharge-admin';
const FIREBASE_API_KEY = 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';

// Rechercher un dossier dans Firestore par champ

function firestoreCreate(data) {
  return new Promise(function(resolve, reject) {
    var fields = {};
    Object.keys(data).forEach(function(k) {
      var v = data[k];
      if (typeof v === 'number')       fields[k] = {doubleValue: v};
      else if (typeof v === 'boolean') fields[k] = {booleanValue: v};
      else if (v === null)             fields[k] = {nullValue: null};
      else                             fields[k] = {stringValue: String(v)};
    });
    var body = JSON.stringify({fields: fields});
    var options = {
      hostname: FIRESTORE_URL,
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/dossiers?key=' + FIREBASE_API_KEY,
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        console.log('firestoreCreate status:', res.statusCode, d.slice(0,100));
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d);
        else reject(new Error('Firestore create error: ' + res.statusCode + ' ' + d.slice(0,100)));
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function firestoreQuery(field, value) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      structuredQuery: {
        from: [{collectionId: 'dossiers'}],
        where: {
          fieldFilter: {
            field: {fieldPath: field},
            op: 'EQUAL',
            value: {stringValue: String(value)}
          }
        },
        limit: 1
      }
    });
    var options = {
      hostname: FIRESTORE_URL,
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents:runQuery?key=' + FIREBASE_API_KEY,
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        try {
          var results = JSON.parse(d);
          var doc = results.find(function(r){ return r.document; });
          if (doc && doc.document) {
            var name = doc.document.name;
            var docId = name.split('/').pop();
            resolve({id: docId, data: doc.document.fields});
          } else {
            resolve(null);
          }
        } catch(e) { console.error('firestoreQuery error:', e.message); resolve(null); }
      });
    });
    req.on('error', function(e){ console.error('firestoreQuery req error:', e.message); resolve(null); });
    req.end(body);
  });
}

// Mettre a jour un champ dans un document Firestore
function firestoreUpdate(docId, fields) {
  return new Promise(function(resolve) {
    // Convertir les champs en format Firestore
    var fsFields = {};
    var masks = [];
    Object.keys(fields).forEach(function(k) {
      var v = fields[k];
      masks.push(k);
      if (typeof v === 'number') fsFields[k] = {doubleValue: v};
      else if (typeof v === 'boolean') fsFields[k] = {booleanValue: v};
      else fsFields[k] = {stringValue: String(v)};
    });
    var maskStr = masks.map(function(m){ return 'updateMask.fieldPaths=' + m; }).join('&');
    var body = JSON.stringify({fields: fsFields});
    var options = {
      hostname: FIRESTORE_URL,
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/dossiers/' + docId + '?' + maskStr + '&key=' + FIREBASE_API_KEY,
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        console.log('Firestore update response:', res.statusCode, d.slice(0,100));
        resolve(res.statusCode);
      });
    });
    req.on('error', function(e){ console.error('firestoreUpdate error:', e.message); resolve(0); });
    req.end(body);
  });
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


function checkFirestoreDoublon(email, axonautId) {
  var checks = [];
  if (email && email.length > 3) {
    checks.push(
      firestoreQuery('email', email).then(function(d) {
        return d ? {source:'firestore', field:'email', doc:d} : null;
      }).catch(function(){ return null; })
    );
  }
  if (axonautId && axonautId.length > 0) {
    checks.push(
      firestoreQuery('axonautId', String(axonautId)).then(function(d) {
        return d ? {source:'firestore', field:'axonautId', doc:d} : null;
      }).catch(function(){ return null; })
    );
  }
  if (!checks.length) return Promise.resolve(null);
  return Promise.all(checks).then(function(results) {
    return results.find(function(r){ return r !== null; }) || null;
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


// ═══════════════════════════════════════
// ZAPIER NOTIFICATION WEBHOOKS
// ═══════════════════════════════════════
var ZAPIER = {
  nouveau_prospect:  'https://hooks.zapier.com/hooks/catch/21452394/4bkfyuv/',
  mission_affectee:  'https://hooks.zapier.com/hooks/catch/21452394/4bkfd5b/',
  rdv_client:        'https://hooks.zapier.com/hooks/catch/21452394/4bkfrne/',
  rdv_installation:  'https://hooks.zapier.com/hooks/catch/21452394/4bkfrne/',
  rdv_previsit:      'https://hooks.zapier.com/hooks/catch/21452394/43tp5em/',
  rdv_sav:           'https://hooks.zapier.com/hooks/catch/21452394/43tns35/',
  rdv_admin:         'https://hooks.zapier.com/hooks/catch/21452394/4bkfs78/',
  installation_client: 'https://hooks.zapier.com/hooks/catch/21452394/4bkfzho/',
  installation_admin:  'https://hooks.zapier.com/hooks/catch/21452394/4bkfkye/'
};

function sendZapierNotif(url, data) {
  var body = JSON.stringify(data);
  var urlObj = new URL(url);
  var options = {
    hostname: urlObj.hostname,
    path:     urlObj.pathname,
    method:   'POST',
    headers:  {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
  };
  var req = https.request(options, function(res) {
    res.on('data', function(){});
    res.on('end', function(){ console.log('Zapier notif sent:', url.split('/').pop()); });
  });
  req.on('error', function(e){ console.warn('Zapier notif error:', e.message); });
  req.write(body);
  req.end();
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
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version: '8.4'}));
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
            // Pas trouve dans RDB - chercher dans Firestore
            checkFirestoreDoublon('', String(companyId)).then(function(fsDoc) {
              if (fsDoc) {
                console.log('Adresse mise a jour dans Firestore pour companyId:', companyId);
                return firestoreUpdate(fsDoc.doc.id, addrData).then(function() {
                  res.writeHead(200); res.end(JSON.stringify({success: true, source: 'firestore'}));
                });
              }
              // Vraiment pas trouve - mettre en attente
              console.log('Prospect non trouve - adresse en attente pour companyId:', companyId);
              addrData.companyId = String(companyId);
              return firebasePost('/pending_addresses.json', addrData).then(function() {
                res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Adresse en attente'}));
              });
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
        // Ne pas remplacer par valeur par defaut - laisser vide si titre vide
        if (!borneTxt5 || borneTxt5.length < 2) borneTxt5 = '';
        var montant5 = Number(data.pre_tax_amount || data.total_amount || 0);
        var ref5 = 'AX-' + devisNum5;
        console.log('Quotation created:', companyName5, borneTxt5, montant5);

        return findDossierByAxonautId(companyId5).then(function(existing) {
          var update5 = {
            ref: ref5,
            statut: 'prospect',
            updatedAt: new Date().toISOString()
          };
          if (borneTxt5) update5.borne = borneTxt5;
          if (montant5) update5.montant = montant5;
          if (existing) {
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', update5);
          }
          // Verifier dans Firestore par axonautId, puis par email, puis par nom
          var emailAxonaut = data.email || data.contact_email || '';
          return checkFirestoreDoublon('', String(companyId5)).then(function(fsDoc) {
            if (!fsDoc && emailAxonaut) return checkFirestoreDoublon(emailAxonaut, '');
            return fsDoc;
          }).then(function(fsDoc) {
            if (!fsDoc && companyName5) {
              return firestoreQuery('client', companyName5).then(function(d){
                return d?{source:'firestore',field:'client',doc:d}:null;
              }).catch(function(){return null;});
            }
            return fsDoc;
          }).then(function(fsDoc) {
            if (fsDoc) {
              console.log('Doublon Firestore (quotation.created) pour', companyName5, '- mise a jour');
              var fsUpdate = {ref: ref5, axonautId: String(companyId5), updatedAt: new Date().toISOString()};
              if (montant5) fsUpdate.montant = montant5;
              if (borneTxt5) fsUpdate.borne = borneTxt5;
              if (fsDoc.data && fsDoc.data.statut === 'lead') {
                fsUpdate.statut = 'prospect';
                console.log('Lead FB converti en prospect:', companyName5);
              }
              return firestoreUpdate(fsDoc.doc.id, fsUpdate);
            }
          }).then(function(result) { if (result) return;
            // Vraiment nouveau - creer
            update5.client = companyName5; update5.axonautId = String(companyId5 || '');
            update5.tel = ''; update5.email = ''; update5.adresse = ''; update5.ville = ''; update5.cp = ''; update5.dept = '';
            update5.installateur = null; update5.rdv = null; update5.notes = ''; update5.imported = false;
            update5.createdAt = new Date().toISOString();
            return firebasePost('/commandes_axonaut.json', update5);
          });
        }).then(function() {
          // Mettre a jour Firestore aussi
          if (montant5 > 0) {
            firestoreQuery('ref', ref5).then(function(fsDoc) {
              if (!fsDoc) return firestoreQuery('axonautId', String(companyId5));
              return fsDoc;
            }).then(function(fsDoc) {
              if (fsDoc) firestoreUpdate(fsDoc.id, {montant: montant5, ref: ref5, updatedAt: new Date().toISOString()});
            }).catch(function(e){ console.error('Firestore created update error:', e.message); });
          }
          res.writeHead(200); res.end(JSON.stringify({success: true}));
        });
      }

      // ═══ QUOTATION.UPDATED ═══
      // Mise a jour devis ou signature
      if (topic.includes('quotation.updated')) {
        var statut6  = (data.status || '').toLowerCase();
        var sigDate6 = data.electronic_signature_date;
        // Signe UNIQUEMENT si topic customerAnswer ET statut accepte ET date de signature presente
        var isCustomerAnswer = topic.includes('customeranswer');
        var hasSignature = sigDate6 && sigDate6 !== null && sigDate6 !== 'null'
                        && typeof sigDate6 === 'object' && sigDate6.date;
        var isSigned = isCustomerAnswer
                    && (statut6 === 'accepted' || statut6 === 'signed' || statut6 === 'won')
                    && hasSignature;
        console.log('isSigned check - topic:', topic, '| statut:', statut6, '| hasSignature:', !!hasSignature, '| isSigned:', isSigned);
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
          // Ne pas ecraser la borne si valeur par defaut ou vide
          if (borneTxt6 && borneTxt6 !== 'Borne a definir') update6.borne = borneTxt6;
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
        }).then(function(existing) {
          // Mettre a jour aussi Firestore si montant change
          if (montant6 > 0) {
            var refSearch = ref6;
            firestoreQuery('ref', refSearch).then(function(fsDoc) {
              if (!fsDoc) return firestoreQuery('axonautId', String(companyId6));
              return fsDoc;
            }).then(function(fsDoc) {
              if (fsDoc) {
                var fsUpdate = {
                  montant: montant6,
                  updatedAt: new Date().toISOString()
                };
                if (borneTxt6) fsUpdate.borne = borneTxt6;
                if (isSigned) fsUpdate.statut = 'new';
                return firestoreUpdate(fsDoc.id, fsUpdate);
              }
            }).catch(function(e){ console.error('Firestore montant update error:', e.message); });
          }
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
        commentaire:   body.remarques    || body.comment || '',
        type_logement: body.type_logement || body.logement  || '',
        statut:    'prospect',
        installateur: null, rdv: null, notes: '',
        imported: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      console.log('Prospect depuis Zapier:', dossier.client, '|', dossier.adresse, dossier.ville, dossier.cp, '|', dossier.tel);

      // Chercher par axonautId en priorite UNIQUEMENT
      // Ne pas chercher par email pour eviter de mettre a jour le mauvais prospect
      var findPromise = axonautId
        ? findDossierByAxonautId(axonautId)
        : Promise.resolve(null);

      findPromise.then(function(existing) {
        return existing;
      }).then(function(existing) {
        if (existing) {
          // Mettre a jour avec les nouvelles infos (selective)
          var update = {updatedAt: new Date().toISOString()};
          var fields = ['client','tel','email','adresse','ville','cp','dept','borne','axonautId','type_logement','montant','commentaire'];
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
            // Notif 1 - Nouveau prospect
            sendZapierNotif(ZAPIER.nouveau_prospect, {
              client:  dossier.client,
              tel:     dossier.tel,
              email:   dossier.email,
              adresse: dossier.adresse,
              ville:   dossier.ville,
              cp:      dossier.cp,
              borne:   dossier.borne || 'A definir'
            });
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


  // ═══════════════════════════════════════
  // ROUTE: /notify
  // Recoit les notifications depuis le dashboard et l'espace installateur
  // ═══════════════════════════════════════
  if (req.url === '/notify' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var type = body.type;
      console.log('Notification:', type, '|', body.client);

      if (type === 'mission_affectee') {
        // Notif 2 - Mission affectee → Installateur
        sendZapierNotif(ZAPIER.mission_affectee, {
          client:       body.client,
          adresse:      body.adresse,
          ville:        body.ville,
          tel:          body.tel,
          borne:        body.borne,
          installateur: body.installateur,
          inst_email:   body.inst_email,
          inst_code:    body.inst_code,
          notes:        body.notes || ''
        });
      } else if (type === 'rdv_confirme') {
        // Choisir le hook selon le type de RDV
        var rdvType = body.rdvType || 'install';
        var rdvHook = rdvType === 'previsit' ? ZAPIER.rdv_previsit
                    : rdvType === 'sav'      ? ZAPIER.rdv_sav
                    :                         ZAPIER.rdv_installation;
        console.log('RDV type:', rdvType, '→', rdvHook);
        // Notif → Client (selon type)
        sendZapierNotif(rdvHook, {
          client:       body.client,
          email:        body.email,
          tel:          body.tel,
          rdv:          body.rdv,
          installateur: body.installateur,
          borne:        body.borne,
          adresse:      body.adresse,
          ville:        body.ville || '',
          cp:           body.cp || '',
          adresse_complete: (body.adresse || '') + (body.ville ? ', ' + body.ville : '') + (body.cp ? ' ' + body.cp : '')
        });
        // Notif 4 - RDV confirmé → Admin (toujours)
        sendZapierNotif(ZAPIER.rdv_admin, {
          client:       body.client,
          rdv:          body.rdv,
          rdvType:      rdvType,
          installateur: body.installateur,
          borne:        body.borne,
          adresse:      body.adresse,
          ville:        body.ville
        });
      } else if (type === 'installation_terminee') {
        // Notif 5 - Installation terminée → Client
        sendZapierNotif(ZAPIER.installation_client, {
          client:       body.client,
          email:        body.email,
          borne:        body.borne,
          adresse:      body.adresse,
          ville:        body.ville || '',
          cp:           body.cp || '',
          adresse_complete: (body.adresse || '') + (body.ville ? ', ' + body.ville : '') + (body.cp ? ' ' + body.cp : ''),
          installateur: body.installateur,
          date:         body.date || new Date().toLocaleDateString('fr-FR')
        });
        // Notif 6 - Installation terminée → Admin
        sendZapierNotif(ZAPIER.installation_admin, {
          client:       body.client,
          borne:        body.borne,
          adresse:      body.adresse,
          ville:        body.ville || '',
          cp:           body.cp || '',
          adresse_complete: (body.adresse || '') + (body.ville ? ', ' + body.ville : '') + (body.cp ? ' ' + body.cp : ''),
          installateur: body.installateur,
          date:         body.date || new Date().toLocaleDateString('fr-FR'),
          rapport:      body.rapport || ''
        });
      }

      res.writeHead(200); res.end(JSON.stringify({success: true}));
    });
    return;
  }


  // ═══════════════════════════════════════
  // ROUTE: /lead-webhook
  // Recoit les leads Facebook depuis Zapier
  // ═══════════════════════════════════════
  if (req.url === '/lead-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Lead Facebook recu:', JSON.stringify(body).slice(0, 400));

      var cp = body.cp || body.code_postal || body.zip || '';
      var lead = {
        client:       body.client || body.nom_prenom || body.full_name || body.name || '',
        email:        body.email  || body.mail || '',
        tel:          body.tel    || body.telephone || body.phone || '',
        cp:           String(cp),
        dept:         cp ? String(cp).slice(0, 2) : '',
        type_logement: body.type_logement || body.logement || '',
        statut:       'lead',
        source:       'Facebook Lead Ads',
        adresse:      '',
        ville:        '',
        borne:        '',
        montant:      0,
        ref:          'FB-' + Date.now(),
        installateur: null,
        rdv:          null,
        notes:        '',
        imported:     false,
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString()
      };

      console.log('Lead:', lead.client, '|', lead.email, '|', lead.tel, '|', lead.cp);

      // Recuperer la ville depuis le code postal via API gouvernementale
      function getVilleFromCP(cp) {
        return new Promise(function(resolve) {
          if (!cp) { resolve(''); return; }
          var opts = {
            hostname: 'geo.api.gouv.fr',
            path: '/communes?codePostal=' + cp + '&fields=nom&limit=1',
            method: 'GET'
          };
          var req2 = https.request(opts, function(res2) {
            var d = '';
            res2.on('data', function(c){ d += c; });
            res2.on('end', function() {
              try {
                var data = JSON.parse(d);
                resolve(data && data.length > 0 ? data[0].nom : '');
              } catch(e) { resolve(''); }
            });
          });
          req2.on('error', function(){ resolve(''); });
          req2.setTimeout(5000, function(){ req2.destroy(); resolve(''); });
          req2.end();
        });
      }

      // Verifier si lead existe deja par email
      // Verifier doublon dans RDB puis Firestore
      findDossierByEmail(lead.email).then(function(existing) {
        if (existing) {
          console.log('Lead deja existant (RDB):', existing.data.client);
          res.writeHead(200); res.end(JSON.stringify({success: true, action: 'already_exists'}));
          return Promise.resolve();
        }
        // Verifier doublon Firestore uniquement si email valide
        var emailCheck = lead.email && lead.email.length > 3
          ? checkFirestoreDoublon(lead.email, '')
          : Promise.resolve(null);
        return emailCheck.then(function(fsDoc) {
          if (fsDoc) {
            var existingStatut = fsDoc.doc && fsDoc.doc.data ? fsDoc.doc.data.statut : '';
            // Si c'etait un lead FB → passer en prospect avec les nouvelles infos
            if (existingStatut === 'lead') {
              console.log('Lead FB converti en prospect via formulaire:', lead.client, '| email:', lead.email);
              var update = {
                statut:    'prospect',
                updatedAt: new Date().toISOString()
              };
              // Mettre a jour avec les infos du formulaire (plus completes)
              if (lead.client) update.client = lead.client;
              if (lead.tel)    update.tel    = lead.tel;
              if (lead.adresse) update.adresse = lead.adresse;
              if (lead.cp)     { update.cp = lead.cp; update.dept = lead.cp.slice(0,2); }
              if (lead.type_logement) update.type_logement = lead.type_logement;
              return firestoreUpdate(fsDoc.doc.id, update).then(function() {
                res.writeHead(200); res.end(JSON.stringify({success: true, action: 'lead_converted_to_prospect'}));
              });
            }
            console.log('Dossier deja existant (Firestore email):', lead.client);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'already_exists_firestore'}));
            return;
          }
          // Verifier par telephone uniquement si email ET tel identiques (doublon strict)
          // On ne bloque plus sur le seul telephone pour eviter les faux positifs
          return getVilleFromCP(lead.cp).then(function(ville) {
          if (ville) {
            lead.ville = ville;
            lead.dept  = lead.cp ? lead.cp.slice(0, 2) : '';
            console.log('Ville resolue:', ville, 'pour CP:', lead.cp);
          }
          // Sauvegarder directement dans Firestore
          lead.createdAt = new Date().toISOString();
          lead.updatedAt = new Date().toISOString();
          return firestoreCreate(lead);
            }).then(function() {
              console.log('Lead FB cree dans Firestore:', lead.client, '| Ville:', lead.ville);
          // Notif admin - nouveau lead
          sendZapierNotif(ZAPIER.nouveau_prospect, {
            client:  lead.client,
            tel:     lead.tel,
            email:   lead.email,
            adresse: 'CP: ' + lead.cp,
            ville:   lead.type_logement,
            cp:      lead.cp,
            borne:   'Lead Facebook - Formulaire non rempli'
          });
          res.writeHead(200); res.end(JSON.stringify({success: true, action: 'created'}));
          });      // close getVilleFromCP.then
          });      // close emailCheck.then
      }).catch(function(e) {
        console.error('Lead error:', e.message);
        res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
      });
    });
    return;
  }



  // ═══ SYNC MONTANTS DEPUIS ZAPIER ═══
  if (req.url === '/sync-montants-zap' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin','*');
    var body = '';
    req.on('data', function(c){ body += c; });
    req.on('end', function() {
      try {
        var payload = JSON.parse(body);
        var quotations;

        // Mode 1 : Zapier envoie champs separés (num, montant, companyId, borne)
        if (payload.num || payload.number) {
          var num = String(payload.num || payload.number || '').replace('#','');
          quotations = [{
            num:       num,
            ref:       'AX-' + num,
            refHash:   'AX-#' + num,
            montant:   Number(payload.montant || payload.pre_tax_amount || 0),
            companyId: String(payload.companyId || payload.company_id || ''),
            borne:     String(payload.borne || payload.title || '')
          }];
        }
        // Mode 2 : tableau JSON
        else {
          quotations = payload.quotations;
          if (typeof quotations === 'string') try { quotations = JSON.parse(quotations); } catch(e) {}
          if (!Array.isArray(quotations)) quotations = [quotations];
        }

        console.log('Sync Zap: received', quotations.length, 'quotations');
        var updated = 0;

        var chain = Promise.resolve();
        quotations.forEach(function(q) {
          chain = chain.then(function() {
            var num   = String(q.number || q.id || q.num || '');
            var ref1  = 'AX-' + num;
            var ref2  = 'AX-#' + num;
            var mont  = Number(q.pre_tax_amount || q.total_amount || q.montant || 0);
            var cid   = String(q.company_id || q.companyId || '');
            if (!mont || !num) return Promise.resolve();

            return firestoreQuery('ref', ref1).then(function(d) {
              return d || firestoreQuery('ref', ref2);
            }).then(function(d) {
              return d || (cid ? firestoreQuery('axonautId', cid) : null);
            }).then(function(d) {
              if (!d) return;
              var upd = { montant: mont, updatedAt: new Date().toISOString() };
              var titre = (q.title || q.subject || q.borne || '').replace(/<[^>]*>/g,'').trim();
              if (titre && titre.length > 2) upd.borne = titre;
              updated++;
              console.log('Updated:', d.id, 'montant:', mont);
              return firestoreUpdate(d.id, upd);
            });
          });
        });

        chain.then(function() {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, updated: updated }));
        }).catch(function(e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });

      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'JSON invalide: ' + e.message }));
      }
    });
    return;
  }


  // ═══ PROXY AXONAUT QUOTATIONS ═══
  if (req.url === '/axonaut-quotations' && req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    var options = {
      hostname: 'app.axonaut.com',
      path: '/api/v1/quotations?limit=200',
      method: 'GET',
      headers: { 'apiKey': '619080bd85898f22780e9d463e107e8ac30647619080' }
    };
    var proxyReq = https.request(options, function(proxyRes) {
      var data = '';
      proxyRes.on('data', function(c){ data += c; });
      proxyRes.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var qs = Array.isArray(parsed) ? parsed : (parsed.data || parsed.quotations || []);
          var result = qs.map(function(q) {
            return {
              number:        q.number || '',
              pre_tax_amount: Number(q.pre_tax_amount || 0),
              company_id:    String(q.company_id || '')
            };
          });
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify(result));
        } catch(e) {
          res.writeHead(500);
          res.end(JSON.stringify({error: e.message}));
        }
      });
    });
    proxyReq.on('error', function(e) {
      res.writeHead(500);
      res.end(JSON.stringify({error: e.message}));
    });
    proxyReq.setTimeout(10000, function() {
      proxyReq.destroy();
      res.writeHead(504);
      res.end(JSON.stringify({error: 'Timeout'}));
    });
    proxyReq.end();
    return;
  }


  // ═══ GOOGLE ADS WEBHOOK ═══
  if (req.url === '/google-ads-webhook' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin','*');
    var body = '';
    req.on('data', function(c){ body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var lead = {
          client:    (data.client || data.full_name || data.name || '').trim(),
          tel:       (data.tel || data.phone || data.phone_number || '').trim(),
          email:     (data.email || '').trim().toLowerCase(),
          cp:        (data.cp || data.zip_code || data.postal_code || '').trim(),
          ville:     '',
          dept:      '',
          statut:    'prospect',
          source:    'google_ads',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        if (lead.cp) lead.dept = lead.cp.slice(0,2);
        if (!lead.client) { res.writeHead(400); res.end(JSON.stringify({error:'Nom requis'})); return; }

        console.log('Google Ads lead:', lead.client, lead.tel);

        // Verifier doublon
        checkFirestoreDoublon(lead.email, '').then(function(existing) {
          if (existing) {
            console.log('Doublon Google Ads:', lead.client);
            res.writeHead(200); res.end(JSON.stringify({success:true, action:'already_exists'}));
            return;
          }
          // Résolution ville
          return getVilleFromCP(lead.cp).then(function(ville) {
            if (ville) { lead.ville = ville; }
            return firestoreCreate(lead);
          }).then(function() {
            console.log('Google Ads lead créé:', lead.client, '|', lead.ville);
            res.writeHead(200); res.end(JSON.stringify({success:true, action:'created'}));
          });
        }).catch(function(e) {
          console.error('Google Ads error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({error:e.message}));
        });
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error:'JSON invalide'}));
      }
    });
    return;
  }


  // ═══ IMPORT LEADS RDB → FIRESTORE ═══
  if (req.url === '/import-rdb-leads' && req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin','*');

    firebaseGet('/commandes_axonaut.json').then(function(data) {
      if (!data) {
        res.writeHead(200);
        res.end(JSON.stringify({success:true, imported:0, message:'RDB vide'}));
        return;
      }

      var keys = Object.keys(data);
      var toImport = keys.filter(function(k) {
        var d = data[k];
        return d && d.client && !d.imported;
      });

      console.log('RDB leads a importer:', toImport.length, '/', keys.length);

      var imported = 0;
      var errors = 0;
      var chain = Promise.resolve();

      toImport.forEach(function(key) {
        chain = chain.then(function() {
          var lead = data[key];
          // Verifier si deja dans Firestore
          var emailCheck = lead.email && lead.email.length > 3
            ? checkFirestoreDoublon(lead.email, '')
            : Promise.resolve(null);

          return emailCheck.then(function(existing) {
            if (existing) {
              console.log('Deja dans Firestore:', lead.client);
              // Marquer comme importé dans RDB
              return firebasePatch('/commandes_axonaut/' + key + '.json', {imported: true});
            }
            // Creer dans Firestore
            var doc = Object.assign({}, lead, {
              imported: true,
              updatedAt: new Date().toISOString()
            });
            return firestoreCreate(doc).then(function() {
              imported++;
              console.log('Import OK:', lead.client);
              return firebasePatch('/commandes_axonaut/' + key + '.json', {imported: true});
            });
          }).catch(function(e) {
            errors++;
            console.error('Import error pour', lead.client, ':', e.message);
          });
        });
      });

      chain.then(function() {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          total: toImport.length,
          imported: imported,
          errors: errors
        }));
      }).catch(function(e) {
        res.writeHead(500);
        res.end(JSON.stringify({error: e.message}));
      });

    }).catch(function(e) {
      res.writeHead(500);
      res.end(JSON.stringify({error: e.message}));
    });
    return;
  }


  // ═══ BULK IMPORT LEADS ═══
  if (req.url === '/bulk-import' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin','*');
    parseBody(req).then(function(body) {
      var leads = body.leads || [];
      if (!leads.length) { res.writeHead(400); res.end(JSON.stringify({error:'No leads'})); return; }
      var imported = 0, errors = 0;
      var chain = Promise.resolve();
      leads.forEach(function(lead) {
        chain = chain.then(function() {
          var doc = {
            client:        lead.client || '',
            email:         (lead.email || '').toLowerCase(),
            tel:           lead.tel || '',
            cp:            lead.cp || '',
            dept:          lead.cp ? lead.cp.slice(0,2) : '',
            ville:         lead.ville || '',
            type_logement: lead.type_logement || '',
            statut:        'lead',
            source:        'Facebook Lead Ads',
            ref:           'FB-' + Date.now(),
            adresse:       '', borne:'', notes:'', montant:0,
            imported:      false,
            createdAt:     new Date().toISOString(),
            updatedAt:     new Date().toISOString()
          };
          return getVilleFromCP(doc.cp).then(function(ville) {
            if (ville) { doc.ville = ville; doc.dept = doc.cp.slice(0,2); }
            return firestoreCreate(doc);
          }).then(function() {
            imported++;
            console.log('Bulk import OK:', doc.client);
          }).catch(function(e) {
            errors++;
            console.error('Bulk import error:', doc.client, e.message);
          });
        });
      });
      chain.then(function() {
        res.writeHead(200);
        res.end(JSON.stringify({success:true, imported:imported, errors:errors}));
      });
    });
    return;
  }

  // ═══ SYNC MONTANTS ═══
  if (req.url === '/sync-montants' && req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin','*');
    var axS={hostname:'app.axonaut.com',path:'/api/v1/quotations?limit=200',method:'GET',headers:{'apiKey':'619080bd85898f22780e9d463e107e8ac30647619080'}};
    https.request(axS,function(aRes){
      var d=''; aRes.on('data',function(c){d+=c;}); aRes.on('end',function(){
        try{
          var raw=JSON.parse(d);
          // Axonaut peut retourner un tableau direct ou {data:[...]} ou {quotations:[...]}
          var qs=Array.isArray(raw) ? raw : (raw.data||raw.quotations||raw.results||[]);
          if(!qs.length && !Array.isArray(raw)){
            console.log('Axonaut raw response:', JSON.stringify(raw).slice(0,300));
            res.writeHead(400);res.end(JSON.stringify({error:'Format inattendu',raw:JSON.stringify(raw).slice(0,200)}));return;
          }
          var result=qs.map(function(q){
            var num=String(q.number||q.id||'');
            return {num:num,ref:'AX-'+num,refHash:'AX-#'+num,montant:Number(q.pre_tax_amount||q.total_amount||0),companyId:String(q.company_id||''),borne:(q.title||q.subject||'').replace(/<[^>]*>/g,'').trim()};
          }).filter(function(q){return q.montant>0;});
          res.writeHead(200);res.end(JSON.stringify({success:true,quotations:result}));
        }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
      });
    }).on('error',function(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}).end();
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({error: 'Route inconnue'}));
});

server.listen(PORT, function() {
  console.log('PowerRecharge API v8.4 demarree sur port', PORT);
});
