const https = require('https');
const http  = require('http'); 

const FIREBASE_URL = process.env.FIREBASE_URL || 'powerrecharge-admin-default-rtdb.europe-west1.firebasedatabase.app';
const FIREBASE_KEY = process.env.FIREBASE_KEY || 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';
const PORT         = process.env.PORT || 3000;
const AXONAUT_KEY  = process.env.AXONAUT_KEY || '619080bd85898f22780e9d463e107e8ac30647619080';

// ============================================================
// FACEBOOK MARKETING API
// ============================================================
const FB_AD_ACCOUNT = process.env.FB_AD_ACCOUNT || 'act_879279033941952';
const FB_TOKEN      = process.env.FB_TOKEN || 'EAAkwkK5SXKABSKwAy3uSRdbDpuJ43lCljSW9ZAn5x4Gl9fyxutjo1LpAxZCBoh9DlCWiyezeLOEacC7cQoR5tGw1hdNZBc26Sl0sesm6OGciOJg80YmjG0AcltQNsOrazh8QMDwMVYkrAOmv0jP6giIvEUfrIbU68m8VKI4lvzfAQ8miwQU40oJZC7ZAp7SazFTdj';

// ============================================================
// GOOGLE ADS API
// ============================================================
const GADS_DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN || 'Jqy9k5vhwfuh1tgrCySsLw';
const GADS_CLIENT_ID       = process.env.GADS_CLIENT_ID       || '339872384438-dfl7hmifahvadeplmsqdgeahh4mmhvm2.apps.googleusercontent.com';
const GADS_CLIENT_SECRET   = process.env.GADS_CLIENT_SECRET   || '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';
const GADS_REFRESH_TOKEN   = process.env.GADS_REFRESH_TOKEN   || '';
const GADS_CUSTOMER_ID     = process.env.GADS_CUSTOMER_ID     || '8548958815'; // Compte publicitaire Power Recharge
const GADS_MCC_ID          = process.env.GADS_MCC_ID          || '1045381552'; // Manager PowerRecharge Manager

// ============================================================
// PROTECTION GLOBALE — évite que les erreurs non catchées tuent le process
// ============================================================
process.on('uncaughtException', function(err) {
  console.error('[UNCAUGHT EXCEPTION] Le serveur continue malgré :', err.message);
});
process.on('unhandledRejection', function(reason) {
  console.error('[UNHANDLED REJECTION] Le serveur continue malgré :', reason && reason.message ? reason.message : reason);
});

// ============================================================
// POINT 2 — RATE LIMITING (protection crash & surcoût VPS)
// ============================================================
var _rlMap = {}; // {ip: [timestamps]}
function rateLimit(ip, maxReq, windowMs) {
  var now = Date.now();
  if (!_rlMap[ip]) _rlMap[ip] = [];
  _rlMap[ip] = _rlMap[ip].filter(function(t){ return now - t < windowMs; });
  if (_rlMap[ip].length >= maxReq) return false;
  _rlMap[ip].push(now);
  return true;
}
// Nettoyage toutes les 5 min pour éviter la fuite mémoire
setInterval(function(){
  var now = Date.now();
  Object.keys(_rlMap).forEach(function(ip){
    _rlMap[ip] = _rlMap[ip].filter(function(t){ return now - t < 300000; });
    if (!_rlMap[ip].length) delete _rlMap[ip];
  });
}, 300000);

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// ============================================================
// POINT 3 — SANITISATION (protection injection / XSS / exfil)
// ============================================================
function sanitizeStr(val, maxLen) {
  if (val === null || val === undefined) return '';
  var s = String(val).trim();
  // Retire les balises HTML (protection XSS) sans toucher aux apostrophes/guillemets
  // (Firestore n'est pas SQL, les apostrophes dans "rue de l'Eglise" doivent être préservées)
  s = s.replace(/<[^>]*>/g, ''); // retire <script>...</script>, <img onerror=...>, etc.
  s = s.replace(/[<>]/g, '');    // retire les < > orphelins
  return s.slice(0, maxLen || 500);
}
function sanitizeBody(body, schema) {
  // schema = {champ: maxLength}
  var out = {};
  Object.keys(schema).forEach(function(k){
    if (body[k] !== undefined && body[k] !== null) {
      out[k] = typeof body[k] === 'number' ? body[k] : sanitizeStr(body[k], schema[k]);
    }
  });
  return out;
}


// ═══ HELPERS ═══
function stripHtml(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}


const FIRESTORE_URL = 'firestore.googleapis.com';
const FIREBASE_PROJECT = 'powerrecharge-admin';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAIUZttIylRrTBb3BuQsMVJzYgIqu35hc4';

// Rechercher un dossier dans Firestore par champ

function firestoreCreate(data) {
  if (data && data.tel && !data.telE164) { var _e = normalizePhoneE164(data.tel); if (_e) data.telE164 = _e; }
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
            resolve({id: docId, data: decodeFirestoreFields(doc.document.fields)});
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
  if (fields && fields.tel && !fields.telE164) { var _e = normalizePhoneE164(fields.tel); if (_e) fields.telE164 = _e; }
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

// ============================================================
// FIRESTORE GENERIQUE — collection parametrable (utilise pour ekwateur_dossiers)
// ============================================================
function firestoreCreateIn(collection, data) {
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
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/' + collection + '?key=' + FIREBASE_API_KEY,
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        console.log('firestoreCreateIn[' + collection + '] status:', res.statusCode, d.slice(0,100));
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('firestoreCreateIn JSON parse error: ' + e.message)); }
        } else {
          reject(new Error('Firestore create error: ' + res.statusCode + ' ' + d.slice(0,100)));
        }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function firestoreQueryAllIn(collection, field, value) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      structuredQuery: {
        from: [{collectionId: collection}],
        where: {
          fieldFilter: {
            field: {fieldPath: field},
            op: 'EQUAL',
            value: {stringValue: String(value)}
          }
        }
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
          var docs = results.filter(function(r){ return r.document; }).map(function(r) {
            var docId = r.document.name.split('/').pop();
            var out = {id: docId};
            Object.keys(r.document.fields || {}).forEach(function(k) {
              var v = r.document.fields[k];
              out[k] = v.stringValue !== undefined ? v.stringValue
                : v.integerValue !== undefined ? v.integerValue
                : v.doubleValue !== undefined ? v.doubleValue
                : v.booleanValue !== undefined ? v.booleanValue
                : v.nullValue !== undefined ? null : v;
            });
            return out;
          });
          resolve(docs);
        } catch(e) { console.error('firestoreQueryAllIn error:', e.message); resolve([]); }
      });
    });
    req.on('error', function(e){ console.error('firestoreQueryAllIn req error:', e.message); resolve([]); });
    req.end(body);
  });
}

// Décoder les champs Firestore REST → valeurs JS simples
function decodeFirestoreFields(fields) {
  if (!fields) return {};
  var out = {};
  Object.keys(fields).forEach(function(k) {
    var v = fields[k];
    if (!v || typeof v !== 'object') { out[k] = v; return; }
    if (v.stringValue  !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.doubleValue  !== undefined) out[k] = v.doubleValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.nullValue    !== undefined) out[k] = null;
    else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
    else out[k] = v;
  });
  return out;
}

function firestoreQueryIn(collection, field, value) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      structuredQuery: {
        from: [{collectionId: collection}],
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
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error('firestoreQueryIn HTTP error:', res.statusCode, d.slice(0,120));
          resolve(null); return;
        }
        try {
          var results = JSON.parse(d);
          var doc = results.find(function(r){ return r.document; });
          if (doc && doc.document) {
            var name = doc.document.name;
            var docId = name.split('/').pop();
            resolve({id: docId, data: decodeFirestoreFields(doc.document.fields)});
          } else {
            resolve(null);
          }
        } catch(e) { console.error('firestoreQueryIn error:', e.message); resolve(null); }
      });
    });
    req.on('error', function(e){ console.error('firestoreQueryIn req error:', e.message); resolve(null); });
    req.end(body);
  });
}

function firestoreUpdateIn(collection, docId, fields) {
  return new Promise(function(resolve) {
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
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/' + collection + '/' + docId + '?' + maskStr + '&key=' + FIREBASE_API_KEY,
      method: 'PATCH',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        console.log('firestoreUpdateIn[' + collection + '] response:', res.statusCode, d.slice(0,100));
        resolve(res.statusCode);
      });
    });
    req.on('error', function(e){ console.error('firestoreUpdateIn error:', e.message); resolve(0); });
    req.end(body);
  });
}

function firestoreGetIn(collection, docId) {
  return new Promise(function(resolve) {
    var options = {
      hostname: FIRESTORE_URL,
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/' + collection + '/' + docId + '?key=' + FIREBASE_API_KEY,
      method: 'GET'
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        if (res.statusCode === 404) { resolve(null); return; }
        try {
          var parsed = JSON.parse(d);
          resolve({id: docId, data: decodeFirestoreFields(parsed.fields || {})});
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function(){ resolve(null); });
    req.end();
  });
}

// Récupérer un collaborateur depuis son token de session
function collabFromToken(token) {
  if (!token || !token.startsWith('collab_')) return Promise.resolve(null);
  var parts = token.split('_');
  if (parts.length < 3) return Promise.resolve(null);
  var collabId = parts[1];
  return firestoreGetIn('collaborateurs', collabId).then(function(doc) {
    if (!doc || !doc.data) return null;
    // Décoder les champs Firestore REST → valeurs JS simples
    var decoded = {};
    Object.keys(doc.data).forEach(function(k) {
      var v = doc.data[k];
      if (v && v.stringValue  !== undefined) decoded[k] = v.stringValue;
      else if (v && v.integerValue !== undefined) decoded[k] = v.integerValue;
      else if (v && v.booleanValue !== undefined) decoded[k] = v.booleanValue;
      else if (v && v.nullValue    !== undefined) decoded[k] = null;
      else decoded[k] = v;
    });
    var storedToken = decoded.sessionToken || '';
    if (storedToken !== token) return null;
    return {id: collabId, data: decoded};
  }).catch(function() { return null; });
}

function firestoreListIn(collection) {
  return new Promise(function(resolve) {
    var options = {
      hostname: FIRESTORE_URL,
      path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/' + collection + '?key=' + FIREBASE_API_KEY + '&pageSize=300',
      method: 'GET'
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error('firestoreListIn HTTP error:', res.statusCode, d.slice(0,120));
          resolve([]); return;
        }
        try {
          var parsed = JSON.parse(d);
          var docs = (parsed.documents || []).map(function(doc) {
            var id = doc.name.split('/').pop();
            return {id: id, data: doc.fields};
          });
          resolve(docs);
        } catch(e) { console.error('firestoreListIn error:', e.message); resolve([]); }
      });
    });
    req.on('error', function(e){ console.error('firestoreListIn req error:', e.message); resolve([]); });
    req.end();
  });
}

// decodeFirestoreFields défini plus haut (ligne ~291)

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
      // Ne bloquer que si c'est un lead/prospect FB (source facebook ou ref FB-)
      // Les entrées venant d'Axonaut (axonautId présent, source absente) ne bloquent pas les leads FB
      if (d && d.email && d.email.toLowerCase() === email.toLowerCase()) {
        var isFbLead = d.source === 'facebook' || (d.ref && String(d.ref).indexOf('FB-') === 0);
        if (isFbLead) return {key: keys[i], data: d};
      }
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






// Retrouve une mission Ekwateur quelle que soit l'écriture de son identifiant
function trouverMissionEkwateur(id) {
  var essais = variantesIdEkwateur(id);
  return essais.reduce(function(chaine, variante) {
    return chaine.then(function(trouve) {
      if (trouve) return trouve;
      return firestoreQueryIn('ekwateur_dossiers', 'idEkwateur', variante);
    });
  }, Promise.resolve(null));
}

// ── Mails Ekwateur : normalisation et nettoyage ──────────────────────
// DIB-22087, DIB000024514, dib 24514 → tous ramenés à DIB-22087 / DIB-24514
function normaliserIdEkwateur(txt) {
  if (!txt) return '';
  var m = String(txt).match(/DIB[\s\-_.]*0*(\d+)/i);
  return m ? 'DIB-' + m[1] : '';
}
// Les variantes possibles d'un même identifiant, pour retrouver les anciens dossiers
function variantesIdEkwateur(id) {
  var n = String(id || '').replace(/[^0-9]/g, '');
  if (!n) return [id];
  var v = ['DIB-' + n, 'DIB' + n, 'DIB ' + n];
  [8, 9, 10, 11, 12].forEach(function(taille){
    if (n.length >= taille) return;
    var p = n.padStart(taille, '0');
    v.push('DIB' + p, 'DIB-' + p);
  });
  return v.filter(function(x, i){ return v.indexOf(x) === i; }).slice(0, 14);
}
// Corps du mail en texte lisible : balises converties, entités décodées
function mailEnTexte(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|li|h\d)\s*>/gi, '\n')
    .replace(/<\s*(td|th)\s*[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&rsquo;/gi, "'").replace(/&euro;/gi, '€')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/&#(\d+);/g, function(_, n){ try { return String.fromCharCode(n); } catch(e) { return ' '; } })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
// Libellés connus des mails Ekwateur : servent de bornes d'arrêt entre deux champs
var LABELS_EKW = ['Nom','Prénom','Prenom','Mail','E-mail','Email','Tél','Tel','Téléphone','Telephone','Adresse','Logement',
  'Type de logement','Type d\'installation','Puissance souscrite','Emplacement tableau','Emplacement souhaité','Emplacement souhaite',
  'Distance estimée','Distance estimee','Nombre de murs','Installation de la borne','Liste des produits',
  'Indications particulières','Indications particulieres','ID Ekwateur','Identifiant','Référence','Reference','Commentaire','Commentaires'];

// Insère un saut de ligne devant chaque libellé connu : indispensable quand le mail
// arrive sur une seule ligne (« SpieziaMail: ... »). Les libellés les plus longs sont
// traités en premier pour que « Prénom: » ne soit pas coupé en « Pré » + « nom: ».
function echapperRegex(x){ return String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// « Type d'installation », « Type d installation », « Type d’installation » : même libellé
function motifLabel(label){ return echapperRegex(label).replace(/'/g, "['\u2019\u02bc ]?\\s*"); }
function decouperChampsEkw(txt){
  var labels = LABELS_EKW.slice().sort(function(a, b){ return b.length - a.length; }).map(motifLabel);
  var re = new RegExp('(' + labels.join('|') + ')\\s*:', 'gi');
  return String(txt || '').replace(re, function(m){ return '\n' + m; });
}

// Extrait un champ, une fois le mail découpé ligne par ligne
function champEkwateur(content, label) {
  var txt = decouperChampsEkw(content);
  var re = new RegExp('^[\\s>•\\-]*' + motifLabel(label) + '\\s*:\\s*(.+)$', 'im');
  var m = txt.match(re);
  return m ? m[1].trim().replace(/[;,]+$/, '') : '';
}

// ════════════════════════════════════════════════════════════════
// SYNCHRONISATION UNIQUE RDB + FIRESTORE
// Tous les webhooks Axonaut passent par ici : les deux bases sont
// toujours servies, jamais l'une à la place de l'autre.
// ════════════════════════════════════════════════════════════════
var STATUTS_AVANCES = ['devis_envoye','new','devis_signe','affected','accepted','rdv','progress','done','sav','cloture'];
var MAP_STATUT_DEMANDE = {
  lead:'en_attente', prospect:'en_attente', devis_envoye:'devis_envoye',
  new:'devis_signe', devis_signe:'devis_signe', affected:'planifie', accepted:'planifie', rdv:'planifie',
  progress:'en_cours', done:'termine', sav:'termine', cloture:'cloture'
};
var SOURCES_PROTEGEES = ['facebook','Facebook Lead Ads','facebook_lead','google','google_ads'];

// Lit un champ Firestore quel que soit son format (REST ou objet simple)
function fsVal(data, key) {
  if (!data || data[key] === undefined || data[key] === null) return '';
  var v = data[key];
  if (typeof v === 'object') {
    if (v.stringValue  !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue  !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    return '';
  }
  return v;
}

// Cherche un dossier Firestore par axonautId, puis email, puis nom
function trouverDossierFirestore(companyId, email, nom) {
  return checkFirestoreDoublon('', companyId ? String(companyId) : '').then(function(fs) {
    if (fs || !email) return fs;
    return checkFirestoreDoublon(email, '');
  }).then(function(fs) {
    if (fs || !nom) return fs;
    return firestoreQuery('client', nom).then(function(d) {
      return d ? {source:'firestore', field:'client', doc:d} : null;
    }).catch(function(){ return null; });
  }).catch(function(){ return null; });
}

/**
 * opts = {
 *   tag, companyId, email, nom,
 *   fields         : champs à écrire (les valeurs vides sont ignorées)
 *   creerSiAbsentRdb : créer l'entrée RDB si elle n'existe pas
 *   onFirestoreAbsent: callback si le dossier est introuvable dans Firestore
 * }
 */
function syncDossier(opts) {
  opts = opts || {};
  var companyId = opts.companyId ? String(opts.companyId) : '';
  var fields    = opts.fields || {};
  var etat      = { rdb: 'ignoré', fs: 'ignoré' };

  // ── Realtime Database ──
  var pRdb = (companyId ? findDossierByAxonautId(companyId) : Promise.resolve(null)).then(function(existing) {
    if (existing) {
      return firebasePatch('/commandes_axonaut/' + existing.key + '.json', selectiveUpdate(existing.data, fields))
        .then(function(){ etat.rdb = 'mis à jour'; });
    }
    if (!opts.creerSiAbsentRdb) { etat.rdb = 'absent'; return; }
    var nouveau = Object.assign({axonautId: companyId, createdAt: new Date().toISOString()}, fields);
    return firebasePost('/commandes_axonaut.json', nouveau).then(function(){ etat.rdb = 'créé'; });
  }).catch(function(e){ etat.rdb = 'erreur (' + e.message + ')'; });

  // ── Firestore (la base que lit l'application) ──
  var pFs = trouverDossierFirestore(companyId, opts.email || '', opts.nom || '').then(function(fsDoc) {
    if (!fsDoc || !fsDoc.doc) {
      etat.fs = 'absent';
      return opts.onFirestoreAbsent ? opts.onFirestoreAbsent() : null;
    }
    var data = fsDoc.doc.data || {};
    var upd = {};
    Object.keys(fields).forEach(function(k) {
      var v = fields[k];
      if (v === undefined || v === null || v === '' || k === 'updatedAt' || k === 'createdAt') return;
      upd[k] = v;
    });
    // Ne jamais rétrograder un statut déjà avancé
    if (upd.statut) {
      var actuel = fsVal(data, 'statut');
      if (STATUTS_AVANCES.indexOf(actuel) > -1 && actuel !== upd.statut) {
        delete upd.statut;
      }
    }
    // Ne jamais écraser une source publicitaire
    if (upd.source && SOURCES_PROTEGEES.indexOf(fsVal(data, 'source')) > -1) delete upd.source;
    // Ne pas écraser un nom existant par celui d'Axonaut s'il est vide côté source
    if (upd.client && !String(upd.client).trim()) delete upd.client;
    if (companyId && !fsVal(data, 'axonautId')) upd.axonautId = companyId;

    if (!Object.keys(upd).length) { etat.fs = 'rien à changer'; return; }
    upd.updatedAt = new Date().toISOString();
    return firestoreUpdate(fsDoc.doc.id, upd).then(function(){
      etat.fs = 'mis à jour (' + fsDoc.doc.id + ', par ' + fsDoc.field + ')';
      // Dossier partenaire : la demande du collaborateur suit le statut du dossier
      var demandeId = fsVal(data, 'demandeId');
      if (!demandeId || !upd.statut) return;
      var cible = MAP_STATUT_DEMANDE[upd.statut];
      if (!cible) return;
      return firestoreUpdateIn('demandes', demandeId, { statut: cible, updatedAt: upd.updatedAt })
        .then(function(){ console.log('Partenaire : demande ' + demandeId + ' → ' + cible); })
        .catch(function(e){ console.log('maj demande : ' + e.message); });
    });
  }).catch(function(e){ etat.fs = 'erreur (' + e.message + ')'; });

  return Promise.all([pRdb, pFs]).then(function() {
    console.log('sync ' + (opts.tag || '') + ' [' + (opts.nom || companyId) + '] → RDB : ' + etat.rdb + ' | Firestore : ' + etat.fs);
    return etat;
  });
}

// Appeler l'API Axonaut pour recuperer les adresses d'une entreprise
function getAxonautAddresses(companyId) {
  return new Promise(function(resolve) {
    var options = {
      hostname: 'app.axonaut.com', family: 4, lookup: axonautLookup,
      path: '/api/v1/companies/' + companyId + '/addresses',
      method: 'GET',
      headers: {'apiKey': AXONAUT_KEY}
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





// ════════════════════════════════════════════════════════════════
// RATTACHEMENT AUTOMATIQUE AUX DEMANDES PARTENAIRES
// Un devis dont le téléphone correspond à une demande d'un
// collaborateur bascule dans le Kanban partenaire, et la demande
// du collaborateur passe en « devis envoyé ».
// ════════════════════════════════════════════════════════════════
function chercherDemandePartenaire(tel) {
  var cible = normalizePhoneE164(tel);
  if (!cible) return Promise.resolve(null);
  return firestoreListIn('demandes').then(function(docs) {
    var libre = null;
    (docs || []).forEach(function(doc) {
      var d = decodeFirestoreFields(doc.data);
      if (libre) return;
      if (d.statut === 'cloture' || d.dossierId) return;           // déjà rattachée ou clôturée
      if (normalizePhoneE164(d.tel) !== cible) return;
      libre = { id: doc.id, data: d };
    });
    return libre;
  }).catch(function(e) { console.log('chercherDemandePartenaire : ' + e.message); return null; });
}


// Recopie les photos du partenaire dans l'onglet « Photos Client » du dossier
function copierPhotosVersDossier(demandeId, dossierId) {
  if (!agentDb || !demandeId || !dossierId) return Promise.resolve(0);
  return agentDb.collection('demande_photos').where('demandeId', '==', demandeId).get().then(function(snap) {
    if (snap.empty) return 0;
    var cible = agentDb.collection('dossiers').doc(dossierId).collection('client_photos');
    var lot = agentDb.batch(), n = 0;
    snap.forEach(function(doc) {
      var p = doc.data();
      var url = p.url || (p.data ? 'data:' + (p.contentType || 'image/jpeg') + ';base64,' + p.data : '');
      if (!url) return;
      lot.set(cible.doc('part_' + doc.id), {
        url: url,
        label: 'Partenaire — ' + (p.nom || 'photo'),
        photoId: 'part_' + doc.id,
        type: p.url ? 'storage' : 'base64',
        source: 'partenaire',
        uploadedAt: p.at || new Date().toISOString()
      });
      n++;
    });
    if (!n) return 0;
    return lot.commit().then(function() {
      return cible.get().then(function(all) {
        return agentDb.collection('dossiers').doc(dossierId).update({
          clientPhotosCount: all.size, clientPhotosComplete: all.size >= 4, updatedAt: new Date().toISOString()
        });
      });
    }).then(function() { console.log('Partenaire : ' + n + ' photo(s) copiée(s) vers le dossier ' + dossierId); return n; });
  }).catch(function(e) { console.log('copierPhotosVersDossier : ' + e.message); return 0; });
}

// Rattache un dossier Firestore à une demande partenaire
function rattacherDossierPartenaire(dossierId, dossierData, demande) {
  var now = new Date().toISOString();
  var societe = demande.data.societe || '';
  return firestoreUpdate(dossierId, {
    collaborateurId: demande.data.collaborateurId || '',
    collaborateurSociete: societe,
    demandeId: demande.id,
    partenaire: true,
    rattacheLe: now,
    updatedAt: now
  }).then(function() {
    var majDemande = { dossierId: dossierId, updatedAt: now };
    if (['en_attente', 'devis_envoye'].indexOf(demande.data.statut) > -1) majDemande.statut = 'devis_envoye';
    return firestoreUpdateIn('demandes', demande.id, majDemande);
  }).then(function() {
    return copierPhotosVersDossier(demande.id, dossierId);
  }).then(function() {
    console.log('Partenaire : dossier ' + dossierId + ' (' + (dossierData.client || '') + ') rattaché à ' + societe + ' — demande ' + demande.id + ' passée en devis envoyé');
    return true;
  }).catch(function(e) { console.error('rattacherDossierPartenaire : ' + e.message); return false; });
}

// Vérifie si un dossier correspond à une demande partenaire (appelé à l'arrivée d'un devis)
function verifierRattachementPartenaire(companyId, email, nom) {
  return trouverDossierFirestore(companyId ? String(companyId) : '', email || '', nom || '').then(function(fsDoc) {
    if (!fsDoc || !fsDoc.doc) return null;
    var data = fsDoc.doc.data || {};
    if (fsVal(data, 'demandeId')) return null;                      // déjà rattaché
    var tel = fsVal(data, 'tel');
    if (!tel) return null;
    return chercherDemandePartenaire(tel).then(function(demande) {
      if (!demande) return null;
      var simple = {};
      Object.keys(data).forEach(function(k){ simple[k] = fsVal(data, k); });
      return rattacherDossierPartenaire(fsDoc.doc.id, simple, demande);
    });
  }).catch(function(e) { console.log('verifierRattachementPartenaire : ' + e.message); return null; });
}

// ════════════════════════════════════════════════════════════════
// RÉSOLUTION DNS ROBUSTE POUR AXONAUT
// Render échoue régulièrement sur getaddrinfo ENOTFOUND app.axonaut.com.
// On résout via des DNS publics, on garde l'IP en cache, et on réessaie.
// ════════════════════════════════════════════════════════════════
var dns = require('dns');
try { dns.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']); } catch(e) { console.warn('dns.setServers:', e.message); }
var axonautIp = { ip: null, at: 0 };

function axonautLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  var now = Date.now();
  if (axonautIp.ip && now - axonautIp.at < 600000) return cb(null, axonautIp.ip, 4);
  dns.resolve4(hostname, function(err, addrs) {
    if (!err && addrs && addrs.length) { axonautIp = { ip: addrs[0], at: now }; return cb(null, addrs[0], 4); }
    // Repli sur le résolveur système
    dns.lookup(hostname, { family: 4 }, function(e2, addr, fam) {
      if (!e2 && addr) axonautIp = { ip: addr, at: now };
      cb(e2, addr, fam || 4);
    });
  });
}

// Appel GET sur l'API Axonaut, avec 3 tentatives espacées
function axonautGet(path, tentative) {
  tentative = tentative || 1;
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: 'app.axonaut.com', path: path, method: 'GET',
      headers: { 'apiKey': AXONAUT_KEY }, family: 4, lookup: axonautLookup
    }, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        if (res.statusCode >= 400) return reject(new Error('Axonaut HTTP ' + res.statusCode));
        resolve(d);
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function(){ req.destroy(new Error('Axonaut : délai dépassé')); });
    req.end();
  }).catch(function(e) {
    var reseau = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|délai/.test(e.message);
    if (reseau && tentative < 3) {
      axonautIp = { ip: null, at: 0 };   // on force une nouvelle résolution
      var delai = tentative * 1500;
      console.log('Axonaut ' + path + ' : ' + e.message + ' — nouvelle tentative dans ' + (delai/1000) + 's (' + tentative + '/3)');
      return new Promise(function(r){ setTimeout(r, delai); }).then(function(){ return axonautGet(path, tentative + 1); });
    }
    throw e;
  });
}

// Récupère l'URL client d'un devis précis sur l'API Axonaut
function getAxonautQuotationUrl(quotationId) {
  if (!quotationId) return Promise.resolve('');
  return axonautGet('/api/v1/quotations/' + encodeURIComponent(quotationId)).then(function(d) {
    var q = JSON.parse(d);
    return q.customer_portal_url || q.customerPortalUrl || q.portal_url || '';
  }).catch(function(e) { console.log('getAxonautQuotationUrl : ' + e.message); return ''; });
}

// Récupérer les infos complètes d'un prospect Axonaut (pour création manuelle de devis)
function getAxonautCompanyInfo(companyId) {
  if (!companyId) return Promise.resolve(null);
  return new Promise(function(resolve) {
    var options = {
      hostname: 'app.axonaut.com', family: 4, lookup: axonautLookup,
      path: '/api/v1/companies/' + companyId,
      method: 'GET',
      headers: {'apiKey': AXONAUT_KEY}
    };
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c){ d += c; });
      res.on('end', function(){
        try {
          var co = JSON.parse(d);
          getAxonautAddresses(companyId).then(function(addr) {
            var tel = '';
            if (co.phone_numbers && co.phone_numbers.length) tel = co.phone_numbers[0].phone_number || '';
            var email = '';
            if (co.emails && co.emails.length) email = co.emails[0].email || '';
            if (!email && co.contacts && co.contacts.length && co.contacts[0].emails && co.contacts[0].emails.length) {
              email = co.contacts[0].emails[0].email || '';
            }
            resolve({ tel: tel, email: email, adresse: addr.adresse||'', ville: addr.ville||'', cp: addr.cp||'' });
          });
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', function(){ resolve(null); });
    req.setTimeout(8000, function(){ req.destroy(); resolve(null); });
    req.end();
  });
}

// ═══════════════════════════════════════
// ZAPIER NOTIFICATION WEBHOOKS
// ═══════════════════════════════════════
var ZAPIER = {
  nouveau_prospect:  process.env.ZAP_NOUVEAU_PROSPECT  || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfyuv/',
  mission_affectee:  process.env.ZAP_MISSION_AFFECTEE  || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfd5b/',
  rdv_client:        process.env.ZAP_RDV_CLIENT        || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfrne/',
  rdv_installation:  process.env.ZAP_RDV_INSTALLATION  || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfrne/',
  rdv_previsit:      process.env.ZAP_RDV_PREVISIT      || 'https://hooks.zapier.com/hooks/catch/21452394/43tp5em/',
  rdv_sav:           process.env.ZAP_RDV_SAV           || 'https://hooks.zapier.com/hooks/catch/21452394/43tns35/',
  rdv_admin:         process.env.ZAP_RDV_ADMIN         || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfs78/',
  installation_client: process.env.ZAP_INSTALLATION_CLIENT || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfzho/',
  installation_admin:  process.env.ZAP_INSTALLATION_ADMIN || 'https://hooks.zapier.com/hooks/catch/21452394/4bkfkye/'
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
// ════════════════════════════════════════════════════════════════
// AGENT IA — API V1 + V2  (/agent/v1/...)
// Couche sécurisée entre un futur agent IA et Firestore.
// - Firebase Admin SDK (compte de service) : n'utilise PAS la clé publique
// - Authentification : Authorization: Bearer <AGENT_API_KEY>
// - Liste blanche de champs + validation de chaque écriture
// - Historique (timeline) + journal d'audit (agent_audit)
// Si firebase-admin ou les variables d'env manquent, seules ces routes
// sont désactivées : le reste du serveur continue de fonctionner.
// ════════════════════════════════════════════════════════════════
var agentDb = null, agentFV = null, agentBucket = null, agentInitError = null;
(function initAgentAdmin() {
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { agentInitError = 'FIREBASE_SERVICE_ACCOUNT manquant'; console.warn('[agent] ' + agentInitError + ' — routes /agent/v1 désactivées'); return; }
  try {
    var admin = require('firebase-admin');
    var sa;
    try { sa = JSON.parse(raw); } catch (e) { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
    var app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'agent');
    agentDb = app.firestore();
    agentFV = admin.firestore.FieldValue;
    try { agentBucket = app.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET || (sa.project_id + '.firebasestorage.app')); }
    catch (e2) { console.warn('[agent] Storage indisponible :', e2.message); }
    console.log('[agent] Firebase Admin SDK initialisé (projet ' + sa.project_id + ')');
  } catch (e) {
    agentInitError = e.message;
    console.error('[agent] Initialisation Admin SDK impossible :', e.message);
  }
})();

// ── Téléphone : normalisation E.164 (France par défaut) ──────────────
function normalizePhoneE164(tel) {
  if (!tel) return '';
  var s = String(tel).replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  if (s[0] === '+') return s.length >= 11 ? s : '';
  if (s.length === 10 && s[0] === '0') return '+33' + s.slice(1);
  if (s.length === 9 && /^[1-9]/.test(s)) return '+33' + s;
  if (s.length === 11 && s.indexOf('33') === 0) return '+' + s;
  return '';
}
function phoneVariants(e164) {
  var v = [e164];
  if (e164.indexOf('+33') === 0) {
    var n = e164.slice(3);
    v.push('0' + n, '33' + n, n, '+33 ' + n);
  }
  return v.slice(0, 10);
}

// ── Validateurs ───────────────────────────────────────────────────────
function vStr(max) { return function (x) { if (typeof x !== 'string') return { error: 'texte attendu' }; x = x.trim(); if (!x) return { error: 'vide' }; if (x.length > max) return { error: 'max ' + max + ' caractères' }; return { value: x }; }; }
function vNum(min, max) { return function (x) { var n = typeof x === 'string' ? parseFloat(x.replace(',', '.')) : x; if (typeof n !== 'number' || isNaN(n)) return { error: 'nombre attendu' }; if (n < min || n > max) return { error: 'entre ' + min + ' et ' + max }; return { value: n }; }; }
function vEnum(list) { return function (x) { return list.indexOf(x) > -1 ? { value: x } : { error: 'valeurs possibles : ' + list.join(', ') }; }; }
function vEmail(x) { return (typeof x === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim())) ? { value: x.trim().toLowerCase() } : { error: 'email invalide' }; }
function vCp(x) { x = String(x || '').trim(); return /^\d{5}$/.test(x) ? { value: x } : { error: 'code postal à 5 chiffres' }; }

// Champs que l'agent a le droit de modifier (et rien d'autre)
var AGENT_FIELDS = {
  'email':                  vEmail,
  'cp':                     vCp,
  'type_logement':          vStr(40),
  'projet.vehiculeMarque':  vStr(60),
  'projet.vehiculeModele':  vStr(60),
  'projet.puissanceKw':     vNum(1, 50),
  'projet.phase':           vEnum(['mono', 'tri']),
  'projet.abonnementKva':   vNum(3, 36),
  'projet.distanceM':       vNum(0, 200),
  'projet.emplacement':     vEnum(['interieur', 'exterieur']),
  'projet.lieu':            vEnum(['garage', 'parking', 'facade', 'autre']),
  'projet.typePassage':     vStr(120),
  'projet.borneSouhaitee':  vStr(80),
  'agent.stage':            vEnum(['nouveau', 'contacte', 'en_qualification', 'qualifie']),
  'agent.nextAction':       vStr(300),
  // L'agent peut enregistrer un refus (STOP) mais jamais accorder un consentement
  'consent.whatsapp':       function (x) { return x === false ? { value: false } : { error: 'l\'agent peut seulement enregistrer un refus (false)' }; },
  // Seule transition de statut autorisée : lead → prospect (vérifiée à part)
  'statut':                 vEnum(['prospect'])
};

// ── Qualification : ce qui manque, calculé par le serveur ─────────────
function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
var MISSING_RULES = [
  { key: 'client',               label: 'Nom',                      q: 'Pouvez-vous me rappeler votre nom ?',                                                                    has: function (d) { return !!(d.client && String(d.client).trim()); } },
  { key: 'cp',                   label: 'Code postal',              q: 'Quel est le code postal du lieu d\'installation ?',                                                      has: function (d) { return !!d.cp; } },
  { key: 'type_logement',        label: 'Type de logement',         q: 'S\'agit-il d\'une maison ou d\'un appartement en copropriété ?',                                          has: function (d) { return !!(d.type_logement || d.typeLogement); } },
  { key: 'projet.vehicule',      label: 'Véhicule',                 q: 'Quel véhicule souhaitez-vous recharger ?',                                                               has: function (d) { return !!(getPath(d, 'projet.vehiculeModele') || getPath(d, 'projet.vehiculeMarque') || d.vehicule); } },
  { key: 'projet.distanceM',     label: 'Distance tableau → borne', q: 'Environ quelle distance y a-t-il entre votre tableau électrique et l\'emplacement prévu pour la borne ?', has: function (d) { return getPath(d, 'projet.distanceM') != null; } },
  { key: 'projet.emplacement',   label: 'Emplacement',              q: 'La borne sera-t-elle installée à l\'intérieur (garage) ou à l\'extérieur ?',                             has: function (d) { return !!getPath(d, 'projet.emplacement'); } },
  { key: 'projet.phase',         label: 'Mono / triphasé',          q: 'Votre installation est-elle en monophasé ou en triphasé ? C\'est indiqué sur votre compteur ou votre facture.', has: function (d) { return !!getPath(d, 'projet.phase'); } },
  { key: 'projet.abonnementKva', label: 'Puissance abonnement',     q: 'Quelle est la puissance de votre abonnement électrique, en kVA ? Elle figure sur votre facture.',        has: function (d) { return getPath(d, 'projet.abonnementKva') != null; } },
  { key: 'docs.photoTableau',    label: 'Photo du tableau',         q: 'Pourriez-vous m\'envoyer une photo de votre tableau électrique ?',                                       has: function (d) { return !!getPath(d, 'docs.photoTableau'); } },
  { key: 'docs.photoEmplacement',label: 'Photo de l\'emplacement',  q: 'Et une photo de l\'endroit où vous souhaitez installer la borne ?',                                       has: function (d) { return !!getPath(d, 'docs.photoEmplacement'); } }
];
function computeMissing(d) {
  var missing = [], filled = [];
  MISSING_RULES.forEach(function (r) {
    if (r.has(d)) filled.push(r.label); else missing.push({ key: r.key, label: r.label, question: r.q });
  });
  var humanSuggested = [];
  var logement = String(d.type_logement || d.typeLogement || '').toLowerCase();
  if (/appart|copro|collectif/.test(logement)) humanSuggested.push('Copropriété / appartement : validation humaine recommandée');
  if ((getPath(d, 'projet.distanceM') || 0) > 40) humanSuggested.push('Distance importante (> 40 m)');
  var score = Math.round(filled.length / MISSING_RULES.length * 100);
  return { missing: missing, filled: filled, score: score, humanSuggested: humanSuggested, nextQuestion: missing[0] ? missing[0].question : null };
}

// ── Utilitaires Firestore (Admin SDK) ─────────────────────────────────
function agentSerialize(v) {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(agentSerialize);
  if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = agentSerialize(v[k]); }); return o; }
  return v;
}
function agentGetProspect(id) {
  return agentDb.collection('dossiers').doc(id).get().then(function (snap) {
    if (!snap.exists) return null;
    var d = snap.data(); if (d.deleted) return null;
    d.id = snap.id; return d;
  });
}
function agentTimeline(id, action, extra) {
  return agentDb.collection('dossiers').doc(id).collection('timeline').add(Object.assign({
    action: action, type: 'agent', color: 'var(--purple)', actor: 'agent',
    date: new Date().toLocaleDateString('fr-FR'), timestamp: agentFV.serverTimestamp()
  }, extra || {}));
}
function agentAudit(req, prospectId, action, payload, result) {
  var p = JSON.stringify(payload || {}); if (p.length > 4000) p = p.slice(0, 4000) + '…';
  return agentDb.collection('agent_audit').add({
    prospectId: prospectId || null, action: action, method: req.method, path: req.url.split('?')[0],
    payload: p, result: result, ip: (req.headers['x-forwarded-for'] || '').split(',')[0] || null,
    at: agentFV.serverTimestamp()
  }).catch(function (e) { console.warn('[agent] audit error:', e.message); });
}
function agentRefreshCache(id, d) {
  var m = computeMissing(d);
  return agentDb.collection('dossiers').doc(id).update({
    'agent.missing': m.missing.map(function (x) { return x.label; }),
    'agent.qualificationScore': m.score,
    'agent.missingUpdatedAt': new Date().toISOString()
  }).then(function () { return m; });
}


// Applique une mise à jour en respectant la liste blanche (utilisée par PATCH et par l'agent IA)
function agentApplyPatch(id, d, input, req) {
  var nowIso = new Date().toISOString();
  var ref = agentDb.collection('dossiers').doc(id);
  if (getPath(d, 'agent.humanRequired')) return Promise.resolve({ code: 423, body: { error: 'Dossier en attente d\'intervention humaine : modifications bloquées' } });
  var update = {}, errors = {}, changes = [];
  Object.keys(input || {}).forEach(function (k) {
    var validator = AGENT_FIELDS[k];
    if (!validator) { errors[k] = 'champ non autorisé'; return; }
    var r = validator(input[k]);
    if (r.error) { errors[k] = r.error; return; }
    if (k === 'statut' && d.statut !== 'lead') { errors[k] = 'transition autorisée uniquement depuis lead'; return; }
    var old = getPath(d, k);
    if (old === r.value) return;
    update[k] = r.value; changes.push({ field: k, oldValue: old === undefined ? null : old, newValue: r.value });
    if (k === 'cp') update.dept = r.value.slice(0, 2);
    if (k === 'consent.whatsapp') { update['consent.source'] = 'agent'; update['consent.at'] = nowIso; }
  });
  if (Object.keys(errors).length && !changes.length) { if (req) agentAudit(req, id, 'patch', input, 'rejeté'); return Promise.resolve({ code: 400, body: { error: 'Aucune modification valide', errors: errors } }); }
  if (!changes.length) return Promise.resolve({ code: 200, body: { success: true, changes: [], errors: errors } });
  update['agent.lastInteractionAt'] = nowIso; update.updatedAt = nowIso;
  return ref.update(update).then(function () {
    return Promise.all(changes.map(function (c) {
      return agentTimeline(id, 'Agent : ' + c.field + ' → ' + c.newValue, { field: c.field, oldValue: c.oldValue, newValue: c.newValue });
    }));
  }).then(function () { return agentGetProspect(id); })
    .then(function (nd) { return agentRefreshCache(id, nd); })
    .then(function (q) {
      if (req) agentAudit(req, id, 'patch', input, 'ok');
      return { code: 200, body: { success: true, changes: changes, errors: errors, qualification: q } };
    });
}

// ── Authentification + limite de débit ───────────────────────────────
var agentRate = { windowStart: 0, count: 0 };
function agentAuthOk(req) {
  var key = process.env.AGENT_API_KEY || '';
  if (key.length < 24) return false;
  var m = String(req.headers['authorization'] || '').match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  var a = Buffer.from(m[1]), b = Buffer.from(key);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
function agentRateOk() {
  var now = Date.now();
  if (now - agentRate.windowStart > 60000) { agentRate.windowStart = now; agentRate.count = 0; }
  agentRate.count++;
  return agentRate.count <= 120;
}
function agentSend(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

// ════════════════════════ AGENT IA — V2 : photos + cerveau ════════════════════════
var PHOTO_KINDS = {
  tableau:     { flag: 'docs.photoTableau',     label: 'Tableau électrique' },
  compteur:    { flag: 'docs.photoCompteur',    label: 'Compteur' },
  emplacement: { flag: 'docs.photoEmplacement', label: 'Emplacement de la borne' },
  passage:     { flag: 'docs.photoPassage',     label: 'Passage du câble' },
  autre:       { flag: null,                    label: 'Autre photo' },
  a_classer:   { flag: null,                    label: 'Photo à classer' }
};

// Enregistre une photo dans Storage + la rattache au dossier (visible dans « Mes Photos »)
function agentSavePhoto(id, buffer, contentType, kind, source) {
  if (!agentBucket) return Promise.reject(new Error('Firebase Storage non configuré'));
  kind = PHOTO_KINDS[kind] ? kind : 'a_classer';
  var photoId = 'ag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  var ext = /png/.test(contentType) ? 'png' : 'jpg';
  var path = 'prospects/' + id + '/' + photoId + '.' + ext;
  var token = require('crypto').randomUUID();
  var file = agentBucket.file(path);
  return file.save(buffer, { resumable: false, metadata: { contentType: contentType, metadata: { firebaseStorageDownloadTokens: token } } }).then(function () {
    var url = 'https://firebasestorage.googleapis.com/v0/b/' + agentBucket.name + '/o/' + encodeURIComponent(path) + '?alt=media&token=' + token;
    var info = PHOTO_KINDS[kind];
    return agentDb.collection('dossiers').doc(id).collection('photos').doc(photoId).set({
      url: url, label: info.label, photoId: photoId, type: 'storage', kind: kind,
      storagePath: path, contentType: contentType, source: source || 'agent', uploadedAt: agentFV.serverTimestamp()
    }).then(function () {
      var upd = { updatedAt: new Date().toISOString() };
      if (info.flag) upd[info.flag] = true;
      return agentDb.collection('dossiers').doc(id).update(upd);
    }).then(function () { return agentTimeline(id, 'Photo reçue : ' + info.label, { type: 'photo' }); })
      .then(function () { return { photoId: photoId, url: url, kind: kind, storagePath: path }; });
  });
}

// L'agent identifie ce que montre une photo reçue
function agentClassifyPhoto(id, photoId, kind) {
  if (!PHOTO_KINDS[kind] || kind === 'a_classer') return Promise.resolve({ error: 'type de photo invalide' });
  var ref = agentDb.collection('dossiers').doc(id).collection('photos').doc(photoId);
  return ref.get().then(function (snap) {
    if (!snap.exists) return { error: 'photo introuvable' };
    var info = PHOTO_KINDS[kind];
    return ref.update({ kind: kind, label: info.label }).then(function () {
      var upd = {}; if (info.flag) upd[info.flag] = true;
      return Object.keys(upd).length ? agentDb.collection('dossiers').doc(id).update(upd) : null;
    }).then(function () { return agentTimeline(id, 'Agent : photo identifiée → ' + info.label, { type: 'photo' }); })
      .then(function () { return agentGetProspect(id); })
      .then(function (nd) { return agentRefreshCache(id, nd); })
      .then(function (q) { return { success: true, kind: kind, qualification: q }; });
  });
}

// ── Appel à l'API Claude ──────────────────────────────────────────────
function agentClaude(body) {
  return new Promise(function (resolve, reject) {
    var data = JSON.stringify(body);
    var rq = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(data) }
    }, function (rs) {
      var d = ''; rs.on('data', function (c) { d += c; });
      rs.on('end', function () {
        var j; try { j = JSON.parse(d); } catch (e) { return reject(new Error('Réponse Claude illisible')); }
        if (rs.statusCode >= 400) return reject(new Error('Claude API ' + rs.statusCode + ' : ' + ((j.error && j.error.message) || d.slice(0, 200))));
        resolve(j);
      });
    });
    rq.setTimeout(60000, function () { rq.destroy(new Error('Délai dépassé (Claude API)')); });
    rq.on('error', reject);
    rq.end(data);
  });
}

var AGENT_TOOLS = [
  { name: 'update_prospect',
    description: 'Enregistre dans le dossier les informations données par le prospect. Appelle-le dès qu\'une information utile est donnée, avant de répondre. Champs possibles : projet.vehiculeMarque, projet.vehiculeModele (texte), projet.distanceM (nombre de mètres), projet.emplacement ("interieur"|"exterieur"), projet.lieu ("garage"|"parking"|"facade"|"autre"), projet.phase ("mono"|"tri"), projet.abonnementKva (nombre), projet.puissanceKw (nombre), projet.typePassage (texte), projet.borneSouhaitee (texte), email, cp (5 chiffres), type_logement (texte), agent.stage ("contacte"|"en_qualification"|"qualifie"), agent.nextAction (texte), consent.whatsapp (false uniquement si le prospect refuse d\'être contacté).',
    input_schema: { type: 'object', properties: { fields: { type: 'object', description: 'Paires champ → valeur, ex. {"projet.vehiculeModele":"Model Y","projet.distanceM":9}' } }, required: ['fields'] } },
  { name: 'classify_photo',
    description: 'Indique ce que montre une photo envoyée par le prospect.',
    input_schema: { type: 'object', properties: { photo_id: { type: 'string' }, kind: { type: 'string', enum: ['tableau', 'compteur', 'emplacement', 'passage', 'autre'] } }, required: ['photo_id', 'kind'] } },
  { name: 'add_note',
    description: 'Ajoute une note interne au dossier (visible uniquement par l\'équipe), par exemple une précision utile au devis ou une information que le prospect ne connaît pas.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'update_summary',
    description: 'Met à jour le résumé factuel du projet et la prochaine action pour l\'équipe. À appeler quand la qualification est complète ou qu\'une information importante change.',
    input_schema: { type: 'object', properties: { summary: { type: 'string' }, next_action: { type: 'string' } }, required: ['summary'] } },
  { name: 'request_human',
    description: 'Transfère le dossier à un conseiller humain. Après cet appel, envoie un dernier message au prospect pour lui dire qu\'un conseiller le recontacte.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' }, summary: { type: 'string' } }, required: ['reason', 'summary'] } }
];

function agentSystemPrompt(d, q, photos) {
  var p = d.projet || {};
  var known = [];
  function k(label, v) { if (v !== undefined && v !== null && String(v).trim() !== '') known.push('- ' + label + ' : ' + v); }
  k('Nom', d.client); k('Code postal', d.cp); k('Département', d.dept); k('Ville', d.ville);
  k('Type de logement', d.type_logement || d.typeLogement); k('Email', d.email);
  k('Véhicule', [p.vehiculeMarque, p.vehiculeModele].filter(Boolean).join(' ') || d.vehicule);
  k('Distance tableau → borne (m)', p.distanceM); k('Emplacement', p.emplacement); k('Lieu', p.lieu);
  k('Phase', p.phase); k('Abonnement (kVA)', p.abonnementKva); k('Type de passage', p.typePassage); k('Borne souhaitée', p.borneSouhaitee);
  var missing = q.missing.length ? q.missing.map(function (m, i) { return (i + 1) + '. ' + m.label + ' — suggestion : « ' + m.question + ' »'; }).join('\n') : 'Aucune : la qualification est complète.';
  var ph = photos.length ? photos.map(function (x) { return '- ' + x.photoId + ' : ' + x.label; }).join('\n') : 'Aucune.';
  return [
    'Tu es l\'assistant virtuel de Power Recharge, entreprise qui installe des bornes de recharge pour véhicules électriques en Normandie et dans les Yvelines. Tu échanges avec un prospect par messagerie instantanée.',
    '',
    'OBJECTIF : qualifier son projet pour que l\'équipe prépare un devis, en recueillant uniquement les informations qui manquent.',
    '',
    'STYLE : français, vouvoiement, chaleureux et professionnel. Messages courts (2 à 3 phrases), une seule question à la fois, sans liste ni mise en forme. Un emoji au maximum.',
    '',
    'RÈGLES :',
    '- Ne redemande jamais une information déjà connue (section DOSSIER).',
    '- Suis l\'ordre de la section INFORMATIONS MANQUANTES en reformulant naturellement.',
    '- Dès que le prospect donne une information utile, enregistre-la avec update_prospect avant de répondre. Convertis en valeurs précises (« une dizaine de mètres » → 10). Si c\'est trop vague, redemande poliment.',
    '- Si le prospect ne connaît pas une réponse (phase, kVA), explique en une phrase où la trouver ; s\'il ne sait toujours pas, note-le avec add_note et passe à la suite.',
    '- Quand une photo est reçue, identifie ce qu\'elle montre et appelle classify_photo. Si elle est floue ou hors sujet, demande-en une autre.',
    '- Ne donne jamais de prix, de remise, de délai ferme ni de date d\'intervention : un conseiller s\'en charge avec le devis.',
    '- Ne fais aucun diagnostic électrique ni conseil de sécurité.',
    '- Logement en copropriété : recueille le véhicule et le type de place (parking privé, box, extérieur), puis appelle request_human, car ces projets demandent une étude spécifique.',
    '- Appelle request_human puis préviens le prospect qu\'un conseiller le recontacte si : demande de remise ou négociation, projet professionnel ou plusieurs bornes, mécontentement ou litige, problème électrique ou SAV, question à laquelle tu ne sais pas répondre, ou demande explicite de parler à quelqu\'un.',
    '- Quand toutes les informations sont réunies, appelle update_summary avec un résumé factuel, remercie le prospect et dis-lui qu\'un conseiller lui envoie son devis rapidement.',
    '- N\'invente rien. Si on te demande si tu es une IA, réponds honnêtement que tu es l\'assistant virtuel de Power Recharge.',
    '',
    'DOSSIER (déjà connu) :', known.length ? known.join('\n') : '- (vide)',
    '',
    'INFORMATIONS MANQUANTES (dans l\'ordre) :', missing,
    '',
    'POINTS D\'ATTENTION :', q.humanSuggested.length ? q.humanSuggested.map(function (x) { return '- ' + x; }).join('\n') : '- Aucun.',
    '',
    'PHOTOS DÉJÀ REÇUES :', ph,
    '',
    'Date du jour : ' + new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.'
  ].join('\n');
}

// Exécute un outil demandé par l'agent — toujours via les mêmes garde-fous que l'API
function agentRunTool(id, name, input) {
  input = input || {};
  return agentGetProspect(id).then(function (d) {
    if (!d) return { error: 'dossier introuvable' };
    if (name === 'update_prospect') return agentApplyPatch(id, d, input.fields || {}, null).then(function (r) { return r.body; });
    if (name === 'classify_photo') return agentClassifyPhoto(id, String(input.photo_id || ''), String(input.kind || ''));
    if (name === 'add_note') {
      var t = vStr(2000)(input.text); if (t.error) return { error: t.error };
      return agentTimeline(id, 'Note agent : ' + t.value, { type: 'agent_note' }).then(function () { return { success: true }; });
    }
    if (name === 'update_summary') {
      var s = vStr(3000)(input.summary); if (s.error) return { error: s.error };
      var upd = { 'agent.summary': s.value, 'agent.summaryAt': new Date().toISOString() };
      if (input.next_action) { var na = vStr(300)(input.next_action); if (!na.error) upd['agent.nextAction'] = na.value; }
      return agentDb.collection('dossiers').doc(id).update(upd).then(function () { return agentTimeline(id, 'Résumé de conversation mis à jour'); }).then(function () { return { success: true }; });
    }
    if (name === 'request_human') {
      var rs = vStr(500)(input.reason); if (rs.error) return { error: rs.error };
      var nowIso = new Date().toISOString();
      var hu = { 'agent.humanRequired': true, 'agent.humanReason': rs.value, 'agent.humanRequestedAt': nowIso, 'agent.status': 'paused', updatedAt: nowIso };
      if (input.summary) { var hs = vStr(3000)(input.summary); if (!hs.error) hu['agent.summary'] = hs.value; }
      return agentDb.collection('dossiers').doc(id).update(hu).then(function () {
        return agentTimeline(id, 'Intervention humaine demandée : ' + rs.value, { type: 'agent_human', color: 'var(--red)' });
      }).then(function () {
        if (process.env.ZAP_AGENT_HUMAN) sendZapierNotif(process.env.ZAP_AGENT_HUMAN, { dossierId: id, client: d.client || '', tel: d.tel || '', raison: rs.value, resume: hu['agent.summary'] || '' });
        return { success: true, message: 'Dossier transféré à un conseiller. Préviens le prospect.' };
      });
    }
    return { error: 'outil inconnu' };
  });
}

var TOOL_LABELS = { update_prospect: 'Dossier mis à jour', classify_photo: 'Photo identifiée', add_note: 'Note ajoutée', update_summary: 'Résumé mis à jour', request_human: 'Transfert à un conseiller' };

// Enregistre un message de la conversation
function agentSaveMessage(id, msg) {
  msg.at = new Date().toISOString();
  return agentDb.collection('dossiers').doc(id).collection('messages').add(msg);
}

// Un tour de conversation : message entrant (ou démarrage) → réponse de l'agent
function runAgentTurn(id, opts) {
  opts = opts || {};
  var channel = opts.channel || 'simulateur';
  if (!process.env.ANTHROPIC_API_KEY) return Promise.resolve({ code: 503, body: { error: 'ANTHROPIC_API_KEY manquant sur Render' } });
  return agentGetProspect(id).then(function (d) {
    if (!d) return { code: 404, body: { error: 'Dossier introuvable' } };
    var ref = agentDb.collection('dossiers').doc(id);
    var text = typeof opts.text === 'string' ? opts.text.trim().slice(0, 2000) : '';
    var photoId = opts.photoId ? String(opts.photoId) : '';
    var incoming = Promise.resolve();

    if (text || photoId) {
      var cm = { role: 'client', text: text, channel: channel };
      if (photoId) cm.photoId = photoId;
      incoming = agentSaveMessage(id, cm).then(function () {
        return ref.update({ 'conv.lastClientMsg': text || '[photo]', 'conv.lastMessageAt': new Date().toISOString(), 'conv.messageCount': agentFV.increment(1), 'conv.channel': channel });
      });
    } else if (!opts.start) {
      return { code: 400, body: { error: 'text, photoId ou start requis' } };
    }

    return incoming.then(function () {
      var a = d.agent || {};
      // Opposition (STOP) : réponse de confirmation fixe, puis silence
      if (/^\s*stop\s*$/i.test(text)) {
        var bye = 'C\'est bien noté, nous ne vous contacterons plus par ce canal. Bonne journée.';
        return ref.update({ 'consent.whatsapp': false, 'consent.source': 'client', 'consent.at': new Date().toISOString(), 'agent.status': 'stopped' })
          .then(function () { return agentSaveMessage(id, { role: 'agent', text: bye, channel: channel }); })
          .then(function () { return agentTimeline(id, 'Le prospect a demandé l\'arrêt des messages (STOP)', { color: 'var(--red)' }); })
          .then(function () { return { code: 200, body: { reply: bye, stopped: true } }; });
      }
      if (a.status === 'stopped') return { code: 200, body: { reply: null, stopped: true } };
      if (a.humanRequired) return { code: 200, body: { reply: null, paused: true, reason: a.humanReason || '' } };

      return Promise.all([
        ref.collection('messages').orderBy('at', 'desc').limit(30).get(),
        ref.collection('photos').get()
      ]).then(function (res2) {
        var hist = []; res2[0].forEach(function (x) { hist.unshift(x.data()); });
        var photos = []; res2[1].forEach(function (x) { var p = x.data(); photos.push({ photoId: x.id, label: p.label || '', kind: p.kind || '', storagePath: p.storagePath || '', contentType: p.contentType || 'image/jpeg' }); });

        // Historique → format Claude (rôles alternés, commence par l'utilisateur)
        var msgs = [];
        hist.forEach(function (m) {
          var role = m.role === 'client' ? 'user' : 'assistant';
          var t = m.text || '';
          if (m.photoId) t = (t ? t + '\n' : '') + '[Photo envoyée — id : ' + m.photoId + ']';
          if (!t) return;
          if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + t;
          else msgs.push({ role: role, content: t });
        });
        if (!msgs.length || msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: '[Contexte : le prospect a rempli un formulaire de demande. Démarre la conversation en te présentant et pose la première question utile.]' });
        if (msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: '[Relance : poursuis la conversation.]' });

        // Joindre l'image de la photo qui vient d'arriver pour que l'agent la voie
        var withImage = Promise.resolve();
        var cur = photoId ? photos.filter(function (p) { return p.photoId === photoId; })[0] : null;
        if (cur && cur.storagePath && agentBucket) {
          withImage = agentBucket.file(cur.storagePath).download().then(function (buf) {
            var last = msgs[msgs.length - 1];
            last.content = [{ type: 'image', source: { type: 'base64', media_type: cur.contentType, data: buf[0].toString('base64') } }, { type: 'text', text: last.content }];
          }).catch(function (e) { console.warn('[agent] image non jointe :', e.message); });
        }

        return withImage.then(function () {
          var q = computeMissing(d);
          var system = agentSystemPrompt(d, q, photos);
          var actions = [], finalText = '', lastText = '';
          var model = process.env.AGENT_MODEL || 'claude-sonnet-5';

          function loop(n) {
            return agentClaude({ model: model, max_tokens: 1024, system: system, tools: AGENT_TOOLS, messages: msgs }).then(function (r) {
              var texts = (r.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
              if (texts) lastText = texts;
              var uses = (r.content || []).filter(function (b) { return b.type === 'tool_use'; });
              if (r.stop_reason !== 'tool_use' || !uses.length || n >= 6) { finalText = texts || lastText; return; }
              msgs.push({ role: 'assistant', content: r.content });
              return Promise.all(uses.map(function (u) {
                return agentRunTool(id, u.name, u.input).catch(function (e) { return { error: e.message }; }).then(function (out) {
                  actions.push({ tool: u.name, label: TOOL_LABELS[u.name] || u.name, input: u.input, ok: !(out && out.error) });
                  return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 4000), is_error: !!(out && out.error) };
                });
              })).then(function (results) { msgs.push({ role: 'user', content: results }); return loop(n + 1); });
            });
          }

          return loop(0).then(function () {
            var reply = finalText || 'Merci pour votre message, un conseiller revient vers vous rapidement.';
            return agentSaveMessage(id, { role: 'agent', text: reply, channel: channel, actions: actions }).then(function () { return agentGetProspect(id); });
          }).then(function (nd) {
            // Avancement automatique de l'étape (règles fixes, pas décidées par l'IA)
            var na = nd.agent || {}, upd = { 'conv.lastAgentMsg': finalText || '', 'conv.lastMessageAt': new Date().toISOString(), 'conv.messageCount': agentFV.increment(1), 'agent.lastInteractionAt': new Date().toISOString() };
            if (!na.status) upd['agent.status'] = 'active';
            var nq = computeMissing(nd), stage = na.stage || 'nouveau', ev = [];
            var clientReplied = hist.some(function (m) { return m.role === 'client'; });
            if (!nq.missing.length && stage !== 'qualifie') { upd['agent.stage'] = 'qualifie'; ev.push('Agent : prospect qualifié'); if (nd.statut === 'lead') { upd.statut = 'prospect'; ev.push('Lead qualifié → passé en Prospect'); } }
            else if (clientReplied && (stage === 'nouveau' || stage === 'contacte')) { upd['agent.stage'] = 'en_qualification'; }
            else if (stage === 'nouveau') { upd['agent.stage'] = 'contacte'; }
            upd['agent.missing'] = nq.missing.map(function (x) { return x.label; });
            upd['agent.qualificationScore'] = nq.score;
            return ref.update(upd).then(function () { return Promise.all(ev.map(function (e) { return agentTimeline(id, e); })); })
              .then(function () { return { code: 200, body: { reply: finalText, actions: actions, stage: upd['agent.stage'] || stage, qualification: nq, paused: !!(nd.agent && nd.agent.humanRequired) } }; });
          });
        });
      });
    });
  }).catch(function (e) {
    console.error('[agent] tour de conversation :', e.message);
    return { code: 502, body: { error: e.message } };
  });
}
// ══════════════════════ FIN V2 ══════════════════════

// ── Routeur ───────────────────────────────────────────────────────────
function handleAgentRequest(req, res) {
  var path = req.url.split('?')[0].replace(/\/+$/, '');

  if (path === '/agent/v1/health' && req.method === 'GET') {
    return agentSend(res, 200, { ok: !!agentDb, adminSdk: agentDb ? 'ready' : ('indisponible : ' + agentInitError), apiKeyConfigured: (process.env.AGENT_API_KEY || '').length >= 24, storage: agentBucket ? agentBucket.name : 'non configuré', claude: process.env.ANTHROPIC_API_KEY ? (process.env.AGENT_MODEL || 'claude-sonnet-5') : 'ANTHROPIC_API_KEY manquant' });
  }
  if (!agentDb) return agentSend(res, 503, { error: 'API agent indisponible', detail: agentInitError });
  if (!agentAuthOk(req)) return agentSend(res, 401, { error: 'Non autorisé' });
  if (!agentRateOk()) return agentSend(res, 429, { error: 'Trop de requêtes' });

  var m;

  // GET /agent/v1/prospects/by-phone/:phone
  if ((m = path.match(/^\/agent\/v1\/prospects\/by-phone\/([^/]+)$/)) && req.method === 'GET') {
    var e164 = normalizePhoneE164(decodeURIComponent(m[1]));
    if (!e164) return agentSend(res, 400, { error: 'Numéro invalide' });
    var col = agentDb.collection('dossiers');
    return col.where('telE164', '==', e164).limit(5).get().then(function (snap) {
      if (!snap.empty) return snap;
      return col.where('tel', 'in', phoneVariants(e164)).limit(5).get();
    }).then(function (snap) {
      var found = null;
      snap.forEach(function (doc) { var d = doc.data(); if (!found && !d.deleted) { d.id = doc.id; found = d; } });
      if (!found) return agentSend(res, 404, { error: 'Aucun dossier pour ce numéro', telE164: e164 });
      agentSend(res, 200, { prospect: agentSerialize(found), qualification: computeMissing(found) });
    }).catch(function (e) { agentSend(res, 500, { error: e.message }); });
  }

  // /agent/v1/admin/backfill — normalise telE164 et calcule le cache de qualification
  if (path === '/agent/v1/admin/backfill' && req.method === 'POST') {
    return agentDb.collection('dossiers').get().then(function (snap) {
      var batch = agentDb.batch(), n = 0, commits = [];
      snap.forEach(function (doc) {
        var d = doc.data(); if (d.deleted) return;
        var upd = {}, mm = computeMissing(d);
        var e = normalizePhoneE164(d.tel); if (e && e !== d.telE164) upd.telE164 = e;
        upd['agent.missing'] = mm.missing.map(function (x) { return x.label; });
        upd['agent.qualificationScore'] = mm.score;
        batch.update(doc.ref, upd); n++;
        if (n % 450 === 0) { commits.push(batch.commit()); batch = agentDb.batch(); }
      });
      commits.push(batch.commit());
      return Promise.all(commits).then(function () {
        agentAudit(req, null, 'backfill', {}, 'ok ' + n);
        agentSend(res, 200, { success: true, dossiersMisAJour: n });
      });
    }).catch(function (e) { agentSend(res, 500, { error: e.message }); });
  }

  if (!(m = path.match(/^\/agent\/v1\/prospects\/([A-Za-z0-9_-]{6,40})(\/[a-z-]+)?$/))) {
    return agentSend(res, 404, { error: 'Route agent inconnue' });
  }
  var id = m[1], sub = m[2] || '';

  // GET /agent/v1/prospects/:id
  if (sub === '' && req.method === 'GET') {
    return agentGetProspect(id).then(function (d) {
      if (!d) return agentSend(res, 404, { error: 'Dossier introuvable' });
      agentSend(res, 200, { prospect: agentSerialize(d), qualification: computeMissing(d) });
    }).catch(function (e) { agentSend(res, 500, { error: e.message }); });
  }

  // GET /agent/v1/prospects/:id/missing
  if (sub === '/missing' && req.method === 'GET') {
    return agentGetProspect(id).then(function (d) {
      if (!d) return agentSend(res, 404, { error: 'Dossier introuvable' });
      return agentRefreshCache(id, d).then(function (q) { agentSend(res, 200, q); });
    }).catch(function (e) { agentSend(res, 500, { error: e.message }); });
  }

  // GET /agent/v1/prospects/:id/messages
  if (sub === '/messages' && req.method === 'GET') {
    return agentDb.collection('dossiers').doc(id).collection('messages').orderBy('at', 'asc').limit(200).get().then(function (snap) {
      var out = []; snap.forEach(function (x) { var m = x.data(); m.id = x.id; out.push(agentSerialize(m)); });
      agentSend(res, 200, { messages: out });
    }).catch(function (e) { agentSend(res, 500, { error: e.message }); });
  }

  // Toutes les routes suivantes écrivent : on lit le corps JSON
  return parseBody(req).then(function (body) {
    body = body || {};
    return agentGetProspect(id).then(function (d) {
      if (!d) return agentSend(res, 404, { error: 'Dossier introuvable' });
      var ref = agentDb.collection('dossiers').doc(id);
      var nowIso = new Date().toISOString();

      // PATCH /agent/v1/prospects/:id  → champs autorisés uniquement
      if (sub === '' && req.method === 'PATCH') {
        return agentApplyPatch(id, d, body.fields || body, req).then(function (r) { agentSend(res, r.code, r.body); });
      }

      // POST /agent/v1/prospects/:id/chat  { text?, photoId?, start?, channel? }
      if (sub === '/chat' && req.method === 'POST') {
        return runAgentTurn(id, { text: body.text, photoId: body.photoId, start: !!body.start, channel: body.channel || 'simulateur' }).then(function (r) {
          agentAudit(req, id, 'chat', { text: body.text, photoId: body.photoId, start: body.start }, r.code === 200 ? 'ok' : ('erreur ' + r.code));
          agentSend(res, r.code, r.body);
        });
      }

      // POST /agent/v1/demandes/:id/devis  { dataBase64, contentType, montant? }
  if ((m = path.match(/^\/agent\/v1\/demandes\/([A-Za-z0-9_-]{6,40})\/devis$/)) && req.method === 'POST') {
    var demandeId = m[1];
    return parseBody(req).then(function(body) {
      if (!agentBucket) return agentSend(res, 503, { error: 'Firebase Storage non configuré' });
      var ct = String(body.contentType || 'application/pdf');
      if (!/^application\/pdf$/.test(ct)) return agentSend(res, 400, { error: 'Le devis doit être un PDF' });
      var buf = Buffer.from(String(body.dataBase64 || '').replace(/^data:[^,]+,/, ''), 'base64');
      if (buf.length < 500) return agentSend(res, 400, { error: 'Fichier vide ou invalide' });
      if (buf.length > 10 * 1024 * 1024) return agentSend(res, 413, { error: 'PDF trop lourd (10 Mo max)' });
      return agentDb.collection('demandes').doc(demandeId).get().then(function(snap) {
        if (!snap.exists) return agentSend(res, 404, { error: 'Demande introuvable' });
        var dem = snap.data();
        var nom = 'devis_' + demandeId + '_' + Date.now() + '.pdf';
        var chemin = 'devis/' + nom;
        var token = require('crypto').randomUUID();
        return agentBucket.file(chemin).save(buf, { resumable: false, metadata: { contentType: ct, metadata: { firebaseStorageDownloadTokens: token } } })
          .then(function() {
            var url = 'https://firebasestorage.googleapis.com/v0/b/' + agentBucket.name + '/o/' + encodeURIComponent(chemin) + '?alt=media&token=' + token;
            var maj = { devisPdfUrl: url, devisPdfAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            if (body.montant) maj.devisMontant = Number(body.montant) || 0;
            if (['en_attente'].indexOf(dem.statut) > -1) maj.statut = 'devis_envoye';
            return agentDb.collection('demandes').doc(demandeId).update(maj).then(function() {
              // Le dossier lié récupère le lien s'il n'en a pas
              if (!dem.dossierId) return url;
              return agentDb.collection('dossiers').doc(dem.dossierId).get().then(function(d2) {
                if (d2.exists && !d2.data().devisUrl) {
                  return agentDb.collection('dossiers').doc(dem.dossierId).update({ devisUrl: url, updatedAt: new Date().toISOString() });
                }
              }).then(function(){ return url; });
            });
          }).then(function(url) {
            console.log('Devis PDF téléversé pour la demande', demandeId);
            agentAudit(req, demandeId, 'devis-pdf', { taille: buf.length }, 'ok');
            agentSend(res, 200, { success: true, url: url });
          });
      }).catch(function(e){ agentSend(res, 500, { error: e.message }); });
    });
  }

  // POST /agent/v1/prospects/:id/photos  { dataBase64, contentType, kind? }
      if (sub === '/photos' && req.method === 'POST') {
        var ct = String(body.contentType || 'image/jpeg');
        if (!/^image\/(jpeg|png|webp)$/.test(ct)) return agentSend(res, 400, { error: 'Format accepté : jpeg, png ou webp' });
        var b64 = String(body.dataBase64 || '').replace(/^data:[^,]+,/, '');
        var buf = Buffer.from(b64, 'base64');
        if (buf.length < 1000) return agentSend(res, 400, { error: 'Image vide ou invalide' });
        if (buf.length > 6 * 1024 * 1024) return agentSend(res, 413, { error: 'Image trop lourde (6 Mo max)' });
        return agentSavePhoto(id, buf, ct, body.kind, body.source || 'agent').then(function (p) {
          return agentGetProspect(id).then(function (nd) { return agentRefreshCache(id, nd); }).then(function () {
            agentAudit(req, id, 'photo', { kind: p.kind, size: buf.length }, 'ok');
            agentSend(res, 200, Object.assign({ success: true }, p));
          });
        });
      }

      // POST /agent/v1/prospects/:id/notes   { text }
      if (sub === '/notes' && req.method === 'POST') {
        var t = vStr(2000)(body.text); if (t.error) return agentSend(res, 400, { error: 'text : ' + t.error });
        return agentTimeline(id, 'Note agent : ' + t.value, { type: 'agent_note' }).then(function () {
          return ref.update({ 'agent.lastInteractionAt': nowIso });
        }).then(function () { agentAudit(req, id, 'note', body, 'ok'); agentSend(res, 200, { success: true }); });
      }

      // POST /agent/v1/prospects/:id/events  { action, field?, oldValue?, newValue? }
      if (sub === '/events' && req.method === 'POST') {
        var a = vStr(300)(body.action); if (a.error) return agentSend(res, 400, { error: 'action : ' + a.error });
        var extra = {}; ['field', 'oldValue', 'newValue'].forEach(function (k) { if (body[k] !== undefined) extra[k] = String(body[k]).slice(0, 300); });
        return agentTimeline(id, a.value, extra).then(function () { agentAudit(req, id, 'event', body, 'ok'); agentSend(res, 200, { success: true }); });
      }

      // POST /agent/v1/prospects/:id/summary  { summary, nextAction? }
      if (sub === '/summary' && req.method === 'POST') {
        var s = vStr(3000)(body.summary); if (s.error) return agentSend(res, 400, { error: 'summary : ' + s.error });
        var upd = { 'agent.summary': s.value, 'agent.summaryAt': nowIso, 'agent.lastInteractionAt': nowIso };
        if (body.nextAction) { var na = vStr(300)(body.nextAction); if (!na.error) upd['agent.nextAction'] = na.value; }
        return ref.update(upd).then(function () { return agentTimeline(id, 'Résumé de conversation mis à jour'); })
          .then(function () { agentAudit(req, id, 'summary', body, 'ok'); agentSend(res, 200, { success: true }); });
      }

      // POST /agent/v1/prospects/:id/request-human  { reason, summary? }
      if (sub === '/request-human' && req.method === 'POST') {
        var rs = vStr(500)(body.reason); if (rs.error) return agentSend(res, 400, { error: 'reason : ' + rs.error });
        var hu = { 'agent.humanRequired': true, 'agent.humanReason': rs.value, 'agent.humanRequestedAt': nowIso, 'agent.status': 'paused', updatedAt: nowIso };
        if (body.summary) { var hs = vStr(3000)(body.summary); if (!hs.error) hu['agent.summary'] = hs.value; }
        return ref.update(hu).then(function () {
          return agentTimeline(id, 'Intervention humaine demandée : ' + rs.value, { type: 'agent_human', color: 'var(--red)' });
        }).then(function () {
          if (process.env.ZAP_AGENT_HUMAN) sendZapierNotif(process.env.ZAP_AGENT_HUMAN, { dossierId: id, client: d.client || '', tel: d.tel || '', raison: rs.value, resume: hu['agent.summary'] || getPath(d, 'agent.summary') || '' });
          agentAudit(req, id, 'request-human', body, 'ok');
          agentSend(res, 200, { success: true });
        });
      }

      agentSend(res, 404, { error: 'Route agent inconnue' });
    });
  }).catch(function (e) { console.error('[agent] erreur:', e.message); agentSend(res, 500, { error: e.message }); });
}
// ════════════════════════ FIN AGENT IA — API V1 ════════════════════════


var server = http.createServer(function(req, res) {
  // CORS restreint aux origines connues
  var allowedOrigins = [
    'https://powerrecharge-admin.web.app',
    'https://powerrecharge-admin.firebaseapp.com'
  ];
  var origin = req.headers['origin'] || '';
  // Si l'origine est connue, on la reflète. Sinon on autorise quand même (ne pas bloquer l'app)
  // Les webhooks Axonaut/Zapier sont server-to-server (pas d'Origin header) : toujours OK
  var corsOrigin = allowedOrigins.indexOf(origin) > -1 ? origin : (origin || '*');
  res.setHeader('Access-Control-Allow-Origin', corsOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // API AGENT IA (auth + rate-limit propres)
  if (req.url.indexOf('/agent/v1/') === 0) { handleAgentRequest(req, res); return; }

  // RATE LIMITING
  var ip = getClientIp(req);
  // Webhooks entrants (Axonaut → nous, Zapier → nous) : pas de rate limit (IPs variables)
  var isInboundWebhook = (req.url.indexOf('webhook') > -1) && req.method === 'POST';
  var maxReq = isInboundWebhook ? 999999 : 300; // entrée: illimité, sortie/UI: 300/min
  if (!rateLimit(ip, maxReq, 60000)) {
    res.writeHead(429, {'Content-Type': 'application/json', 'Retry-After': '60'});
    res.end(JSON.stringify({error: 'Trop de requetes. Reessayez dans 60 secondes.'}));
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'PowerRecharge API OK', version:'9.1'}));
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
        var prospect = {
          client:    data.name || ('PROSPECT-' + data.id),
          tel:       contact.cellphone_number || contact.phone_number || contact.mobile || '',
          email:     contact.email || '',
          adresse:   data.address_street || '',
          ville:     data.address_city || '',
          cp:        String(data.address_zip_code || ''),
          dept:      data.address_zip_code ? String(data.address_zip_code).slice(0,2) : '',
          axonautId: String(data.id),
          statut:    'prospect',
          source:    'axonaut',
          borne: '', montant: 0, ref: 'PROSPECT-' + data.id,
          installateur: null, rdv: null, notes: '', imported: false,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        if (employees.length === 0) {
          console.log('company.created sans employees — création directe en attendant company.updated:', prospect.client);
        } else {
          console.log('company.created:', prospect.client, prospect.tel, prospect.email);
        }
        return findDossierByAxonautId(data.id).then(function(existing) {
          if (existing) {
            console.log('company.created: dossier RDB déjà existant, mise à jour');
            return firebasePatch('/commandes_axonaut/' + existing.key + '.json', selectiveUpdate(existing.data, prospect));
          }
          // Vérifier aussi dans Firestore
          return firestoreQuery('axonautId', String(data.id)).then(function(fsExisting) {
            if (fsExisting) {
              console.log('company.created: dossier Firestore déjà existant', fsExisting.id);
              return; // Déjà là, ne pas dupliquer
            }
            // Créer dans Firestore ET dans RDB
            return firestoreCreate(prospect).then(function(fsResult) {
              var newDocId = fsResult && fsResult.name ? fsResult.name.split('/').pop() : null;
              return firebasePost('/commandes_axonaut.json', Object.assign({}, prospect, {firestoreId: newDocId}));
            });
          }).catch(function() {
            return firebasePost('/commandes_axonaut.json', prospect);
          });
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
              // Mettre à jour RDB
              firebasePatch('/commandes_axonaut/' + existing.key + '.json', selectiveUpdate(existing.data, update2));
            } else {
              // Créer dans RDB si pas trouvé
              update2.statut = 'prospect';
              update2.borne = ''; update2.montant = 0; update2.ref = 'PROSPECT-' + data.id;
              update2.installateur = null; update2.rdv = null; update2.notes = '';
              update2.imported = false; update2.createdAt = new Date().toISOString();
              firebasePost('/commandes_axonaut.json', update2).then(function(result) {
                try { var resultKey = JSON.parse(result).name; applyPendingAddress(String(data.id), resultKey); } catch(e){}
              });
            }
            // Toujours mettre à jour Firestore si dossier trouvé par axonautId
            return checkFirestoreDoublon('', String(data.id)).then(function(fsDoc) {
              if (!fsDoc && update2.email) return checkFirestoreDoublon(update2.email, '');
              return fsDoc;
            }).then(function(fsDoc) {
              if (!fsDoc) return;
              var fsUpdate = { updatedAt: new Date().toISOString() };
              if (update2.client) fsUpdate.client = update2.client;
              if (update2.tel)    fsUpdate.tel    = update2.tel;
              if (update2.email)  fsUpdate.email  = update2.email;
              if (update2.adresse) fsUpdate.adresse = update2.adresse;
              if (update2.ville)   fsUpdate.ville   = update2.ville;
              if (update2.cp)      { fsUpdate.cp = update2.cp; fsUpdate.dept = update2.dept; }
              if (!fsDoc.doc.data || !fsDoc.doc.data.axonautId) fsUpdate.axonautId = String(data.id);
              // Ne jamais écraser une source facebook/google
              var existingSource = fsDoc.doc.data && fsDoc.doc.data.source
                ? (fsDoc.doc.data.source.stringValue || fsDoc.doc.data.source || '')
                : '';
              var sourcesProtegees = ['facebook','Facebook Lead Ads','facebook_lead','google','google_ads'];
              if (sourcesProtegees.indexOf(existingSource) === -1 && update2.source) {
                fsUpdate.source = update2.source;
              }
              console.log('Company update Firestore:', fsDoc.doc.id, fsUpdate.client);
              return firestoreUpdate(fsDoc.doc.id, fsUpdate);
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
        var companyId = (data.company && data.company.id) || data.company_id || data.owner_id || data.entity_id;
        var adresse3  = data.address_street || data.street || data.address || data.line1 || '';
        var ville3    = data.address_city   || data.city   || '';
        var cp3       = String(data.address_zip_code || data.zipcode || data.zip_code || data.postal_code || '');
        console.log('Address parsed - CompanyId:', companyId, '| Rue:', adresse3, '| Ville:', ville3, '| CP:', cp3);
        if (!companyId) { res.writeHead(200); res.end(JSON.stringify({success: true, message: 'Pas de company_id'})); return; }
        var addrData = {};
        if (adresse3) addrData.adresse = adresse3;
        if (ville3)   addrData.ville   = ville3;
        if (cp3)      { addrData.cp = cp3; addrData.dept = cp3.slice(0,2); }
        syncDossier({
          tag: 'address', companyId: companyId, nom: (data.company && data.company.name) || '', fields: addrData,
          onFirestoreAbsent: function() {
            console.log('Adresse en attente pour companyId:', companyId);
            return firebasePost('/pending_addresses.json', Object.assign({companyId: String(companyId), updatedAt: new Date().toISOString()}, addrData));
          }
        }).then(function(etat){ res.writeHead(200); res.end(JSON.stringify({success: true, etat: etat})); })
          .catch(function(e){ res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message})); });
        return;
      }

      if (topic === 'employee.created' || topic === 'employee.updated') {
        var companyId4 = data.company_id;
        var tel4   = data.cellphone_number || data.phone_number || data.mobile || '';
        var email4 = data.email || '';
        var nom4   = ((data.firstname || '') + ' ' + (data.lastname || '')).trim();
        console.log('Employee:', data.firstname, data.lastname, email4, tel4, 'Company:', companyId4);
        if (!companyId4) { res.writeHead(200); res.end(JSON.stringify({success: true})); return; }
        var champs4 = {};
        if (tel4)   champs4.tel   = tel4;
        if (email4) champs4.email = email4;
        syncDossier({tag:'employee', companyId: companyId4, email: email4, nom: nom4, fields: champs4})
          .then(function(etat){ res.writeHead(200); res.end(JSON.stringify({success: true, etat: etat})); })
          .catch(function(e){ res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message})); });
        return;
      }

      // ═══ QUOTATION.CREATED ═══
      // Ajouter borne et montant estimé
      if (topic === 'quotation.created') {
        var companyId5   = data.company_id;
        var companyName5 = data.company_name || '';
        var devisNum5    = data.number || data.id || '';
        var borneTxt5    = stripHtml(data.title || data.subject || '');
        if (borneTxt5.startsWith(String(devisNum5))) borneTxt5 = borneTxt5.slice(String(devisNum5).length).trim();
        if (!borneTxt5 || borneTxt5.length < 2) borneTxt5 = '';
        var montant5  = Number(data.pre_tax_amount || data.total_amount || 0);
        var ref5      = 'AX-' + devisNum5;
        var devisUrl5 = data.customer_portal_url || data.customerPortalUrl || data.portal_url || data.devis_url || '';
        var emailAxonaut = data.email || data.contact_email || '';
        console.log('Quotation created:', companyName5, borneTxt5, montant5, devisUrl5 ? '| URL: ' + devisUrl5 : '');

        var nowArr5 = new Date();
        var devisEnvoyeLe = (data.created_at || data.sent_at)
          ? (data.created_at || data.sent_at).toString().replace('T',' ').slice(0,16)
          : nowArr5.getFullYear()+'-'+String(nowArr5.getMonth()+1).padStart(2,'0')+'-'+String(nowArr5.getDate()).padStart(2,'0')
            +' '+String(nowArr5.getHours()).padStart(2,'0')+':'+String(nowArr5.getMinutes()).padStart(2,'0');

        var champs5 = { ref: ref5, statut: 'devis_envoye', datesign: devisEnvoyeLe };
        if (borneTxt5) champs5.borne    = borneTxt5;
        if (montant5)  champs5.montant  = montant5;

        // L'URL du devis n'est pas toujours dans le webhook : on la demande à Axonaut
        var pUrl = devisUrl5 ? Promise.resolve(devisUrl5) : getAxonautQuotationUrl(data.id || devisNum5);
        return pUrl.then(function(url) {
          if (url) { champs5.devisUrl = url; console.log('devisUrl récupéré :', url); }
          else console.log('devisUrl introuvable pour le devis', devisNum5, '— sera complété plus tard');
          return syncDossier({
          tag: 'quotation', companyId: companyId5, email: emailAxonaut, nom: companyName5,
          fields: champs5, creerSiAbsentRdb: true,
          // Aucun dossier dans Firestore : on le crée avec les infos Axonaut
          onFirestoreAbsent: function() {
            console.log('quotation.created : création du dossier Firestore pour', companyName5);
            var nouveau = Object.assign({
              client: companyName5, axonautId: String(companyId5 || ''), email: emailAxonaut,
              tel: '', adresse: '', ville: '', cp: '', dept: '',
              source: 'axonaut', installateur: null, rdv: null, notes: '', imported: false,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            }, champs5);
            return getAxonautCompanyInfo(companyId5).then(function(info) {
              if (info) {
                if (info.tel)     nouveau.tel     = info.tel;
                if (info.email)   nouveau.email   = info.email || emailAxonaut;
                if (info.adresse) nouveau.adresse = info.adresse;
                if (info.ville)   nouveau.ville   = info.ville;
                if (info.cp)      { nouveau.cp = info.cp; nouveau.dept = String(info.cp).slice(0,2); }
              }
              return firestoreCreate(nouveau);
            }).catch(function(){ return firestoreCreate(nouveau); });
          }
          });
        }).then(function(etat){
          return verifierRattachementPartenaire(companyId5, emailAxonaut, companyName5).then(function(){ return etat; });
        }).then(function(etat){
          res.writeHead(200); res.end(JSON.stringify({success: true, etat: etat}));
        }).catch(function(e){
          console.error('quotation.created erreur:', e.message);
          res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
        });
      }

      // ═══ QUOTATION.UPDATED (signature du devis) ═══
      if (topic.includes('quotation.updated')) {
        var statut6  = (data.status || '').toLowerCase();
        var sigDate6 = data.electronic_signature_date;
        var isCustomerAnswer = topic.includes('customeranswer');
        // Axonaut peut envoyer electronic_signature_date comme objet {date:"..."} OU comme string directement
        var hasSignature = sigDate6 && sigDate6 !== null && sigDate6 !== 'null' && sigDate6 !== ''
                        && (
                          (typeof sigDate6 === 'object' && sigDate6.date) ||
                          (typeof sigDate6 === 'string' && sigDate6.length > 0)
                        );
        // Signe si : statut accepte/signe/won ET (signature presente OU customerAnswer OU statut explicitement signe/won)
        var devisNum6 = data.number || data.id || '';
        var ref6 = 'AX-' + devisNum6;
        var borneTxt6 = stripHtml(data.title || data.subject || '');
        if (borneTxt6.startsWith(String(devisNum6))) borneTxt6 = borneTxt6.slice(String(devisNum6).length).trim();
        if (!borneTxt6 || borneTxt6.length < 2) borneTxt6 = '';
        var sigStr6 = '';
        if (sigDate6 && typeof sigDate6 === 'object' && sigDate6.date) sigStr6 = sigDate6.date.slice(0,10);
        else if (sigDate6 && typeof sigDate6 === 'string') sigStr6 = sigDate6.slice(0,10);
        var montant6   = Number(data.pre_tax_amount || data.total_amount || 0);
        var companyId6 = data.company_id;
        console.log('Quotation updated - signe:', isSigned, '| ref:', ref6, '| montant:', montant6);

        var champs6 = { ref: ref6 };
        if (borneTxt6 && borneTxt6 !== 'Borne a definir') champs6.borne = borneTxt6;
        if (montant6) champs6.montant = montant6;
        if (isSigned) {
          champs6.statut = 'devis_signe';
          if (sigStr6) champs6.signeAt = sigStr6;
        }
        var url6 = data.customer_portal_url || data.customerPortalUrl || data.portal_url || '';
        (url6 ? Promise.resolve(url6) : getAxonautQuotationUrl(data.id || devisNum6)).then(function(u){
          if (u) champs6.devisUrl = u;
          return syncDossier({
            tag: 'quotation.updated', companyId: companyId6, email: data.email || '',
            nom: data.company_name || '', fields: champs6, creerSiAbsentRdb: true
          });
        }).then(function(etat){
          res.writeHead(200); res.end(JSON.stringify({success: true, signed: isSigned, etat: etat}));
        }).catch(function(e){
          res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }


      if (topic === 'event.created' || topic === 'event.updated') {
        var evCompanyId = data.company_id ? String(data.company_id) : '';
        var evTitle = data.title || '';
        var evContent = data.content || '';
        // Extraire le montant depuis le contenu HTML du mail (ex: "1 255,45 &euro;")
        var evMontant = 0;
        var montantMatch = evContent.match(/(\d[\d\s]*[,.]?\d*)\s*(?:&euro;|€)/);
        if (montantMatch) {
          evMontant = parseFloat(montantMatch[1].replace(/\s/g,'').replace(',','.')) || 0;
        }
        // Extraire le numéro de devis (ex: "Devis N°935")
        var evRef = '';
        var refMatch = evTitle.match(/[Nn]°\s*#?(\d+)/);
        if (refMatch) evRef = 'AX-#' + refMatch[1];
        // Extraire le lien du devis présent dans le mail (bouton « signer en ligne »)
        var evUrl = '';
        var urlMatch = evContent.match(/https?:\/\/(?:www\.)?axonaut\.com\/[^"'\s<>\\]+/i);
        if (urlMatch) evUrl = urlMatch[0].replace(/&amp;/g, '&').replace(/[.,)]+$/, '');

        if (!evCompanyId) {
          console.log('event.created: pas de company_id, ignoré');
          res.writeHead(200); res.end(JSON.stringify({success: true, message: 'event sans company_id'}));
          return;
        }
        console.log('event.created/updated: company_id', evCompanyId, '| montant:', evMontant, '| ref:', evRef);

        // Chercher le dossier Firestore par axonautId
        firestoreQuery('axonautId', evCompanyId).then(function(fsDoc) {
          if (!fsDoc) {
            // Dossier introuvable — ne pas créer, juste logger
            // Le dossier sera créé par company.created ou formulaire-webhook
            console.log('event.created: dossier Firestore introuvable pour company_id', evCompanyId, '— ignoré (sera créé par un autre webhook)');
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'skipped_not_found'}));
            return;
          }
          var fsData = fsDoc.data || {};
          var fsStatut = fsData.statut && fsData.statut.stringValue ? fsData.statut.stringValue : (fsData.statut || '');
          var statutsAvances = ['devis_envoye','new','devis_signe','affected','accepted','rdv','progress','done','sav','cloture'];
          var fsUpdate = { updatedAt: new Date().toISOString() };
          var montantExistant = Number(fsData.montant && fsData.montant.doubleValue !== undefined ? fsData.montant.doubleValue
                                     : fsData.montant && fsData.montant.integerValue !== undefined ? fsData.montant.integerValue
                                     : (fsData.montant && fsData.montant.stringValue) || fsData.montant || 0);
          // Le montant du mail peut être un reste à charge : il ne remplace pas celui du devis Axonaut
          if (evMontant > 0 && !montantExistant) fsUpdate.montant = evMontant;
          else if (evMontant > 0 && Math.abs(evMontant - montantExistant) > 1) {
            console.log('event : montant du mail (' + evMontant + ') ignoré, devis Axonaut = ' + montantExistant);
          }
          if (evRef && !(fsData.ref && (fsData.ref.stringValue || '').indexOf('AX-') === 0)) fsUpdate.ref = evRef;
          var urlExistante = (fsData.devisUrl && fsData.devisUrl.stringValue) || '';
          if (evUrl && !urlExistante) { fsUpdate.devisUrl = evUrl; console.log('event : lien du devis récupéré →', evUrl); }
          // Passer en devis_envoye si statut vide ou pas encore avancé
          if (!fsStatut || statutsAvances.indexOf(fsStatut) === -1) {
            fsUpdate.statut = 'devis_envoye';
            console.log('event.created: statut mis à jour → devis_envoye pour company_id', evCompanyId);
          }
          return firestoreUpdate(fsDoc.id, fsUpdate).then(function() {
            console.log('event.created: Firestore mis à jour', fsDoc.id, JSON.stringify(fsUpdate));
            return verifierRattachementPartenaire(evCompanyId, '', '');
          }).then(function() {
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'updated'}));
          });
        }).catch(function(e) {
          console.error('event.created Firestore error:', e.message);
          res.writeHead(200); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
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
      // Sanitisation des champs texte
      body = sanitizeBody(body, {
        client:100, nom_prenom:100, name:100, tel:20, email:100,
        adresse:200, ville:80, cp:10, dept:5, borne:200,
        type_logement:80, montant:20, commentaire:500,
        axonautId:50, axonaut_id:50, ref:50, devisUrl:500, source:20
      });

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
        devisUrl:  body.devisUrl || body.devis_url || body.customer_portal_url || body.customerPortalUrl || body.portal_url || '',
        statut:    'prospect',
        source:    body.source || 'site_web',
        installateur: null, rdv: null, notes: '',
        imported: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      console.log('Prospect depuis Zapier:', dossier.client, '|', dossier.adresse, dossier.ville, dossier.cp, '|', dossier.tel);
      console.log('DevisUrl reçu:', dossier.devisUrl || 'ABSENT', '| Body keys:', Object.keys(body).filter(function(k){ return k.toLowerCase().includes('devis') || k.toLowerCase().includes('portal') || k.toLowerCase().includes('url'); }));

      // Cas spécial : payload de mise à jour devisUrl uniquement (Zapier envoie un second POST)
      var rawDevisUrl = body.devisUrl || body.devis_url || body.customer_portal_url || body.customerPortalUrl || '';
      console.log('rawDevisUrl:', rawDevisUrl, '| client:', body.client||body.nom_prenom||'', '| axonautId:', body.axonautId||'');
      if (rawDevisUrl && body.axonautId && !(body.client || body.nom_prenom || body.adresse)) {
        var axIdDevis = String(body.axonautId);
        var refDevis = body.ref ? String(body.ref) : null;

        function tryUpdateDevisUrl(attempt) {
          firestoreQuery('axonautId', axIdDevis).then(function(fsDoc){
            if (!fsDoc && refDevis) return firestoreQuery('ref', refDevis);
            return fsDoc;
          }).then(function(fsDoc){
            var isDeleted = fsDoc && fsDoc.data && fsDoc.data.deleted && (fsDoc.data.deleted.booleanValue === true);
            if (fsDoc && !isDeleted) {
              firestoreUpdate(fsDoc.id, {devisUrl: rawDevisUrl, updatedAt: new Date().toISOString()});
              console.log('DevisUrl mis à jour:', axIdDevis, rawDevisUrl);
            } else if (fsDoc && isDeleted) {
              console.log('DevisUrl: dossier supprimé trouvé, retry pour trouver le nouveau...');
              if (attempt < 6) setTimeout(function(){ tryUpdateDevisUrl(attempt + 1); }, 15000);
            } else if (attempt < 6) {
              // Délais progressifs : 15s, 30s, 60s, 120s, 180s
              var delays = [15000, 30000, 60000, 120000, 180000];
              var delay = delays[attempt - 1] || 60000;
              console.log('DevisUrl: dossier introuvable, retry dans ' + (delay/1000) + 's (tentative ' + attempt + '/6)');
              setTimeout(function(){ tryUpdateDevisUrl(attempt + 1); }, delay);
            } else {
              console.log('DevisUrl: dossier introuvable après 6 tentatives pour axonautId:', axIdDevis);
            }
          }).catch(function(e){ console.warn('DevisUrl update error:', e.message); });
        }
        tryUpdateDevisUrl(1);
        res.writeHead(200); res.end(JSON.stringify({success: true, action: 'devisUrl_queued'}));
        return;
      }

      // Chercher par axonautId en priorité dans RDB puis Firestore, puis par email
      var findPromise = axonautId
        ? findDossierByAxonautId(axonautId).then(function(existing) {
            if (existing) return existing;
            // Pas dans RDB → chercher dans Firestore par axonautId
            return firestoreQuery('axonautId', String(axonautId)).then(function(fsDoc) {
              if (!fsDoc) return null;
              var isDeleted = fsDoc.data && fsDoc.data.deleted && fsDoc.data.deleted.booleanValue === true;
              if (isDeleted) return null;
              // Trouvé dans Firestore → simuler le format RDB pour la suite
              console.log('Formulaire: dossier trouvé dans Firestore par axonautId:', axonautId, fsDoc.id);
              return {key: '__firestore__', firestoreId: fsDoc.id, data: {axonautId: String(axonautId), client: fsDoc.data && fsDoc.data.client && fsDoc.data.client.stringValue ? fsDoc.data.client.stringValue : ''}};
            }).catch(function(){ return null; });
          })
        : Promise.resolve(null);

      findPromise.then(function(existing) {
        return existing;
      }).then(function(existing) {
        if (existing) {
          // Si trouvé uniquement dans Firestore (pas dans RDB)
          if (existing.key === '__firestore__') {
            var fsId = existing.firestoreId;
            var fsUpd = {updatedAt: new Date().toISOString()};
            ['client','tel','email','adresse','ville','cp','dept','borne','axonautId','type_logement','montant','commentaire','devisUrl','source'].forEach(function(f){
              if (dossier[f] && dossier[f] !== '' && dossier[f] !== '0') fsUpd[f] = dossier[f];
            });
            // Ajouter statut prospect si le dossier n'en a pas
            if (!existing.data || !existing.data.statut) fsUpd.statut = 'prospect';
            firestoreUpdate(fsId, fsUpd).catch(function(){});
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'updated_firestore'}));
            return;
          }
          // Mettre a jour avec les nouvelles infos (selective)
          var update = {updatedAt: new Date().toISOString()};
          var fields = ['client','tel','email','adresse','ville','cp','dept','borne','axonautId','type_logement','montant','commentaire','devisUrl'];
          // Ne jamais écraser une source facebook/google
          var existingSourceF = fsDoc.data && fsDoc.data.source
            ? (fsDoc.data.source.stringValue || fsDoc.data.source || '')
            : '';
          var sourcesProtF = ['facebook','Facebook Lead Ads','facebook_lead','google','google_ads'];
          if (sourcesProtF.indexOf(existingSourceF) === -1) fields.push('source');
          fields.forEach(function(f) {
            if (dossier[f] && dossier[f] !== '' && dossier[f] !== '0') update[f] = dossier[f];
          });
          console.log('Mise a jour prospect existant:', existing.data.client);
          firebasePatch('/commandes_axonaut/' + existing.key + '.json', update).then(function() {
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'updated'}));
            // Sync vers Firestore : mettre a jour les champs pertinents
            var fsUpdate = {updatedAt: new Date().toISOString()};
            ['type_logement','borne','montant','commentaire','adresse','ville','cp','dept','tel','email','client','devisUrl','source'].forEach(function(f){
              if (update[f] !== undefined && update[f] !== '' && update[f] !== 0) fsUpdate[f] = update[f];
            });
            // Forcer statut prospect si le dossier Firestore n'en a pas
            fsUpdate._setStatutIfEmpty = 'prospect';
            var axId = dossier.axonautId || (existing.data && existing.data.axonautId) || '';
            var refVal = dossier.ref || (existing.data && existing.data.ref) || '';
            var findFs = axId ? firestoreQuery('axonautId', String(axId)) : Promise.resolve(null);
            findFs.then(function(fsDoc){
              if (!fsDoc && refVal) return firestoreQuery('ref', refVal);
              return fsDoc;
            }).then(function(fsDoc){
              var isDeleted = fsDoc && fsDoc.data && fsDoc.data.deleted && (fsDoc.data.deleted.booleanValue === true);
              // Appliquer statut prospect si le dossier n'en a pas
              var actualFsUpdate = Object.assign({}, fsUpdate);
              delete actualFsUpdate._setStatutIfEmpty;
              if (fsDoc && !isDeleted) {
                var existSt = fsDoc.data && fsDoc.data.statut
                  ? (fsDoc.data.statut.stringValue || fsDoc.data.statut || '')
                  : '';
                if (!existSt) actualFsUpdate.statut = 'prospect';
                firestoreUpdate(fsDoc.id, actualFsUpdate);
              } else if (fsDoc && isDeleted) {
                console.log('Dossier Firestore supprimé (deleted:true) pour axonautId:', axId, '→ création nouveau dossier');
                firestoreCreate(Object.assign({}, dossier, actualFsUpdate));
              } else if (!fsDoc) {
                firestoreCreate(Object.assign({}, dossier, actualFsUpdate));
              }
            }).catch(function(e){ console.warn('Firestore sync error:', e.message); });
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
            // Créer aussi dans Firestore avec source pour ne pas attendre quotation.created
            firestoreCreate(dossier).catch(function(e){ console.warn('Firestore create prospect error:', e.message); });
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
      body = sanitizeBody(body, {
        type:30, client:100, adresse:200, ville:80, tel:20, email:100,
        borne:200, installateur:100, inst_email:100, inst_code:30,
        notes:500, rdv:50, rdvType:20, cp:10
      });
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
  // ============================================================
  // EKWATEUR — Webhook reception mail (via Zapier)
  // ============================================================
  if (req.url === '/ekwateur-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var subject = mailEnTexte(body.subject || body.objet || '');
      var content = mailEnTexte(body.body_plain || body.body || body.content || body.text || '');
      console.log('Ekwateur mail recu — sujet:', subject);

      // ─── Detection du type de mail ───
      var isDemandeInstall   = /demande d.installation ekwateur/i.test(subject);
      var isDemandeVisite    = /demande de visite technique ekwateur/i.test(subject);
      var isConfirmationRdv  = /confirmation de rendez-vous/i.test(subject);
      var isRapportInstall   = /rapport installation/i.test(subject);

      // ─── Extraction ID Ekwateur (toujours present sous une forme ou une autre) ───
      var idEkwateur = normaliserIdEkwateur(subject + ' ' + content);
      if (!idEkwateur) {
        console.log('Ekwateur: ID introuvable, mail a traiter manuellement.');
        console.log('  Sujet   :', subject);
        console.log('  Extrait :', content.slice(0, 400).replace(/\n/g, ' | '));
        res.writeHead(200); res.end(JSON.stringify({success: false, reason: 'id_introuvable', sujet: subject}));
        return;
      }

      function field(label) { return champEkwateur(content, label); }

      // ═══ 1. DEMANDE D'INSTALLATION ═══
      if (isDemandeInstall) {
        var dossierInstall = {
          idEkwateur:    idEkwateur,
          type:          'installation',
          statut:        'nouveau',
          client:        field('Nom'),
          email:         field('Mail'),
          tel:           field('Tél') || field('Tel'),
          adresse:       field('Adresse'),
          logement:      field('Logement'),
          typeLogement:  field('Type de logement'),
          typeInstall:   field("Type d'installation"),
          puissance:     field('Puissance souscrite'),
          emplacementTableau: field('Emplacement tableau'),
          emplacementBorne:   field('Emplacement souhaité') || field('Emplacement souhaite'),
          distance:      field('Distance estimée') || field('Distance estimee'),
          nbMurs:        field('Nombre de murs'),
          poseType:      field('Installation de la borne'),
          produits:      field('Liste des produits'),
          indications:   field('Indications particulières') || field('Indications particulieres'),
          createdAt:     new Date().toISOString(),
          updatedAt:     new Date().toISOString()
        };
        trouverMissionEkwateur(idEkwateur).then(function(existing) {
          if (existing) {
            console.log('Ekwateur installation deja existante:', idEkwateur);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'already_exists'}));
            return;
          }
          return firestoreCreateIn('ekwateur_dossiers', dossierInstall).then(function() {
            console.log('Ekwateur installation creee:', idEkwateur, dossierInstall.client);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'created'}));
          });
        }).catch(function(e) {
          console.error('Ekwateur install error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }

      // ═══ 2. DEMANDE DE VISITE TECHNIQUE (pre-visite) ═══
      if (isDemandeVisite) {
        var dossierPV = {
          idEkwateur:    idEkwateur,
          type:          'previsite',
          statut:        'nouveau',
          client:        field('Nom'),
          email:         field('Mail'),
          tel:           field('Tél') || field('Tel'),
          adresse:       field('Adresse'),
          logement:      field('Logement'),
          typeLogement:  field('Type de logement'),
          typeInstall:   field("Type d'installation"),
          puissance:     field('Puissance souscrite'),
          emplacementTableau: field('Emplacement tableau'),
          emplacementBorne:   field('Emplacement souhaité') || field('Emplacement souhaite'),
          distance:      field('Distance estimée') || field('Distance estimee'),
          nbMurs:        field('Nombre de murs'),
          borneModele:   field('Marque/modèle de la borne') || field('Marque/modele de la borne'),
          accessoires:   field('Accessoires à installer') || field('Accessoires a installer'),
          indications:   field('Indications particulières') || field('Indications particulieres'),
          rdv:           '', // saisi manuellement par l'admin
          createdAt:     new Date().toISOString(),
          updatedAt:     new Date().toISOString()
        };
        trouverMissionEkwateur(idEkwateur).then(function(existing) {
          if (existing) {
            console.log('Ekwateur previsite deja existante:', idEkwateur);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'already_exists'}));
            return;
          }
          return firestoreCreateIn('ekwateur_dossiers', dossierPV).then(function() {
            console.log('Ekwateur previsite creee:', idEkwateur, dossierPV.client);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'created'}));
          });
        }).catch(function(e) {
          console.error('Ekwateur previsite error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }

      // ═══ 3. CONFIRMATION DE RENDEZ-VOUS (installation uniquement, via l'ID en objet) ═══
      if (isConfirmationRdv) {
        var rdvMatch = content.match(/interviendra.{0,40}suivante\s*:\s*([^,]+),\s*le\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}[:h]\d{2})/i);
        if (!rdvMatch) {
          console.log('Ekwateur confirmation RDV: format non reconnu pour', idEkwateur);
          res.writeHead(200); res.end(JSON.stringify({success: false, reason: 'format_rdv_non_reconnu'}));
          return;
        }
        var rdvAdresse = rdvMatch[1].trim();
        var rdvDate    = rdvMatch[2];
        var rdvHeure   = rdvMatch[3].replace('h', ':');
        trouverMissionEkwateur(idEkwateur).then(function(existing) {
          if (!existing) {
            console.log('Ekwateur confirmation RDV: dossier introuvable pour', idEkwateur);
            res.writeHead(200); res.end(JSON.stringify({success: false, reason: 'dossier_introuvable'}));
            return;
          }
          return firestoreUpdateIn('ekwateur_dossiers', existing.id, {
            statut:    'rdv_fixe',
            rdv:       rdvDate + ' ' + rdvHeure,
            rdvAdresse: rdvAdresse,
            updatedAt: new Date().toISOString()
          }).then(function() {
            console.log('Ekwateur RDV confirme:', idEkwateur, rdvDate, rdvHeure);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'rdv_confirmed'}));
          });
        }).catch(function(e) {
          console.error('Ekwateur confirmation RDV error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }

      // ═══ 4. RAPPORT D'INSTALLATION ═══
      if (isRapportInstall) {
        var rapMatch = content.match(/réalisée le\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}[:h]\d{2})\s+chez\s+(.+?)\s+à\s+(.+?)\./i)
                    || content.match(/realisee le\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}[:h]\d{2})\s+chez\s+(.+?)\s+a\s+(.+?)\./i);
        var attachmentUrl = body.attachment_url || body.pdf_url || body.file_url || '';
        trouverMissionEkwateur(idEkwateur).then(function(existing) {
          if (!existing) {
            console.log('Ekwateur rapport: dossier introuvable pour', idEkwateur);
            res.writeHead(200); res.end(JSON.stringify({success: false, reason: 'dossier_introuvable'}));
            return;
          }
          var upd = {
            statut:    'termine',
            updatedAt: new Date().toISOString()
          };
          if (rapMatch) {
            upd.installDate  = rapMatch[1];
            upd.installHeure = rapMatch[2].replace('h', ':');
          }
          if (attachmentUrl) upd.rapportPdfUrl = attachmentUrl;
          return firestoreUpdateIn('ekwateur_dossiers', existing.id, upd).then(function() {
            console.log('Ekwateur installation terminee:', idEkwateur);
            res.writeHead(200); res.end(JSON.stringify({success: true, action: 'termine'}));
          });
        }).catch(function(e) {
          console.error('Ekwateur rapport error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
        });
        return;
      }

      console.log('Ekwateur: type de mail non reconnu. Sujet:', subject);
      res.writeHead(200); res.end(JSON.stringify({success: false, reason: 'type_non_reconnu'}));
    }).catch(function(e) {
      console.error('Ekwateur webhook error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
    });
    return;
  }

  // ═══════════════════════════════════════
  // ROUTE: /whatsapp-webhook
  // ═══════════════════════════════════════
  if (req.url.startsWith('/whatsapp-webhook')) {
    if (req.method === 'GET') {
      var urlParams = new URL('http://localhost' + req.url).searchParams;
      var mode      = urlParams.get('hub.mode');
      var token     = urlParams.get('hub.verify_token');
      var challenge = urlParams.get('hub.challenge');
      var VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'powerrecharge_whatsapp_2026';
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WhatsApp webhook vérifié ✓');
        res.writeHead(200); res.end(challenge);
      } else {
        res.writeHead(403); res.end('Forbidden');
      }
      return;
    }
    if (req.method === 'POST') {
      parseBody(req).then(function(body) {
        try {
          var entry    = body.entry && body.entry[0];
          var changes  = entry && entry.changes && entry.changes[0];
          var value    = changes && changes.value;
          var messages = value && value.messages;
          if (!messages || !messages.length) { res.writeHead(200); res.end('OK'); return; }
          var msg  = messages[0];
          var from = msg.from; // ex: 33764442680
          console.log('WhatsApp message reçu de:', from);

          // Générer toutes les variantes du numéro pour la recherche
          var telRaw = String(from).replace(/[\s\-\.]/g, '');
          var variants = [];
          // Format reçu : 33XXXXXXXXX
          variants.push(telRaw);
          // → 0XXXXXXXXX
          if (telRaw.startsWith('33')) variants.push('0' + telRaw.slice(2));
          // → +33XXXXXXXXX
          variants.push('+' + telRaw);
          if (telRaw.startsWith('33')) variants.push('+33' + telRaw.slice(2));
          // → XXXXXXXXX (sans 0 ni indicatif)
          if (telRaw.startsWith('33')) variants.push(telRaw.slice(2));
          if (telRaw.startsWith('0')) variants.push(telRaw.slice(1));
          // Dédoublonner
          variants = variants.filter(function(v, i, a){ return a.indexOf(v) === i; });
          console.log('WhatsApp: variantes recherchées:', variants.join(', '));

          var p = Promise.resolve(null);
          variants.forEach(function(tel) {
            p = p.then(function(found) { return found || firestoreQuery('tel', tel); });
          });
          p.then(function(fsDoc) {
            if (!fsDoc) { console.log('WhatsApp: aucun dossier pour', telRaw, '| variantes:', variants.join(', ')); return; }
            var isDeleted = fsDoc.data && fsDoc.data.deleted && fsDoc.data.deleted.booleanValue === true;
            if (isDeleted) return;
            return firestoreUpdate(fsDoc.id, { whatsapp: true, whatsappLastMsg: new Date().toISOString(), updatedAt: new Date().toISOString() }).then(function() {
              console.log('WhatsApp: dossier mis à jour →', fsDoc.id);
            });
          }).catch(function(e) { console.error('WhatsApp error:', e.message); });
        } catch(e) { console.error('WhatsApp parse error:', e.message); }
        res.writeHead(200); res.end('OK');
      });
      return;
    }
  }

  if (req.url === '/lead-webhook' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      console.log('Lead Facebook recu:', JSON.stringify(body).slice(0, 400));

      var cpRaw = body.cp || body.code_postal || body.zip || body.postal_code || '';
      var cpStr = String(cpRaw).trim();
      var deptMatch = cpStr.match(/^(\d{2,3})/);
      var dept = deptMatch ? deptMatch[1] : '';
      var cp = cpStr; // Stocker la valeur Meta telle quelle
      var lead = {
        client:       body.client || body.nom_prenom || body.full_name || body.name || '',
        email:        (body.email  || body.mail || '').toLowerCase().trim(),
        tel:          (body.tel    || body.telephone || body.phone || '').replace(/[^0-9+\s]/g, ''),
        cp:           cp,
        dept:         dept,
        type_logement: body.type_logement || body.logement || '',
        statut:       'lead',
        source:       'facebook',
        adresse:      '',
        ville:        '',
        borne:        '',
        montant:      0,
        ref:          'FB-' + Date.now(),
        installateur: null,
        rdv:          null,
        notes:        body.notes || '',
        imported:     false,
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString()
      };

      console.log('Lead:', lead.client, '|', lead.email, '|', lead.tel, '|', lead.cp);

      // Recuperer la ville depuis le code postal via API gouvernementale
      function getVilleFromCP(cp) {
        return new Promise(function(resolve) {
          // Si format Meta "78 - Yvelines" → utiliser directement, pas de lookup
          if (/^\d{2,3}\s*-/.test(String(cp))) { resolve(cp); return; }
          // Si CP à 5 chiffres → lookup ville
          var cpClean = String(cp).replace(/[^0-9]/g, '');
          if (!cpClean || cpClean.length < 4) { resolve(''); return; }
          var opts = {
            hostname: 'geo.api.gouv.fr',
            path: '/communes?codePostal=' + encodeURIComponent(cpClean) + '&fields=nom&limit=1',
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
            var fsData = fsDoc.doc && fsDoc.doc.data ? fsDoc.doc.data : {};
            var existingStatut = fsData.statut && fsData.statut.stringValue
              ? fsData.statut.stringValue
              : (typeof fsData.statut === 'string' ? fsData.statut : '');
            // Si c'etait un lead FB → ignorer le doublon (c'est normal de revoir le même lead)
            if (existingStatut === 'lead') {
              console.log('Lead FB deja en statut lead, ignoré (doublon normal):', lead.email);
              res.writeHead(200); res.end(JSON.stringify({success: true, action: 'already_exists_lead'}));
              return;
            }
            // Si c'est un prospect ou plus avancé → ne pas écraser
            console.log('Dossier deja existant (Firestore email), statut:', existingStatut, '|', lead.client);
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
      hostname: 'app.axonaut.com', family: 4, lookup: axonautLookup,
      path: '/api/v1/quotations?limit=200',
      method: 'GET',
      headers: { 'apiKey': AXONAUT_KEY }
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
          source:    'google',
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
  // ============================================================
  // FACEBOOK MARKETING API — Stats et coût par lead
  // ============================================================
  // ============================================================
  // GOOGLE ADS API — Stats campagnes
  // ============================================================
  if (req.url.startsWith('/google-ads-stats') && req.method === 'GET') {
    var urlParams2 = new URL('http://localhost' + req.url).searchParams;
    var gadsDateRange = urlParams2.get('date_range') || 'LAST_30_DAYS';
    var gadsSince = urlParams2.get('since');
    var gadsUntil = urlParams2.get('until');
    // Construire la clause WHERE selon le mode
    var gadsWhereClause;
    if (gadsSince && gadsUntil) {
      gadsWhereClause = "segments.date BETWEEN '" + gadsSince + "' AND '" + gadsUntil + "'";
    } else {
      gadsWhereClause = 'segments.date DURING ' + gadsDateRange;
    }

    // Étape 1 : Obtenir un access token via le refresh token
    function getGadsAccessToken() {
      return new Promise(function(resolve, reject) {
        var postData = 'client_id=' + encodeURIComponent(GADS_CLIENT_ID)
          + '&client_secret=' + encodeURIComponent(GADS_CLIENT_SECRET)
          + '&refresh_token=' + encodeURIComponent(GADS_REFRESH_TOKEN)
          + '&grant_type=refresh_token';
        var opts = {
          hostname: 'oauth2.googleapis.com',
          path: '/token',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
        };
        var r = https.request(opts, function(res) {
          var d = '';
          res.on('data', function(c){ d += c; });
          res.on('end', function(){
            try {
              var parsed = JSON.parse(d);
              if (parsed.access_token) resolve(parsed.access_token);
              else reject(new Error('Token error: ' + d.slice(0, 200)));
            } catch(e) { reject(e); }
          });
        });
        r.on('error', reject);
        r.end(postData);
      });
    }

    // Étape 2 : Requête Google Ads API (GAQL)
    function queryGoogleAds(accessToken, query) {
      return new Promise(function(resolve, reject) {
        var body = JSON.stringify({ query: query });
        var opts = {
          hostname: 'googleads.googleapis.com',
          path: '/v25/customers/' + GADS_CUSTOMER_ID + '/googleAds:search',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': 'Bearer ' + accessToken,
            'developer-token': GADS_DEVELOPER_TOKEN,
            'login-customer-id': GADS_MCC_ID
          }
        };
        var r = https.request(opts, function(res) {
          var d = '';
          res.on('data', function(c){ d += c; });
          res.on('end', function(){
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error('Google Ads API ' + res.statusCode + ': ' + d.slice(0, 300)));
              return;
            }
            try { resolve(JSON.parse(d)); } catch(e) { reject(e); }
          });
        });
        r.on('error', reject);
        r.end(body);
      });
    }

    getGadsAccessToken().then(function(token) {
      var query = 'SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.cost_per_conversion FROM customer WHERE ' + gadsWhereClause;
      return queryGoogleAds(token, query).then(function(data) {
        var rows = data.results || [];
        var totals = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
        rows.forEach(function(row) {
          var m = row.metrics || {};
          totals.impressions  += Number(m.impressions || 0);
          totals.clicks       += Number(m.clicks || 0);
          totals.cost         += Number(m.costMicros || m.cost_micros || 0);
          totals.conversions  += Number(m.conversions || 0);
        });
        var spendEur = totals.cost / 1000000;
        var ctr      = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
        var cpc      = totals.clicks > 0 ? (spendEur / totals.clicks) : 0;
        var cpl      = totals.conversions > 0 ? (spendEur / totals.conversions) : null;
        var result = {
          success:      true,
          period:       gadsDateRange,
          spend:        spendEur.toFixed(2),
          impressions:  totals.impressions,
          clicks:       totals.clicks,
          conversions:  totals.conversions,
          ctr:          ctr.toFixed(2),
          cpc:          cpc.toFixed(2),
          costPerLead:  cpl ? cpl.toFixed(2) : null
        };
        console.log('Google Ads stats:', result.period, '| Dépenses:', result.spend, '€ | Clics:', result.clicks);
        res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
        res.end(JSON.stringify(result));
      });
    }).catch(function(e) {
      console.error('Google Ads stats error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
    });
    return;
  }

  if (req.url.startsWith('/fb-stats') && req.method === 'GET') {
    // Paramètres optionnels : ?date_preset=last_30d (défaut) ou ?since=2026-01-01&until=2026-01-31
    var urlParams = new URL('http://localhost' + req.url).searchParams;
    var datePreset = urlParams.get('date_preset') || 'last_30d';
    var since = urlParams.get('since');
    var until = urlParams.get('until');

    var timeRange = since && until
      ? 'time_range={"since":"' + since + '","until":"' + until + '"}'
      : 'date_preset=' + datePreset;

    var byDay = urlParams.get('by_day') === '1';
    var timeIncrement = byDay ? '&time_increment=1' : '';

    var fields = 'spend,impressions,clicks,cpm,cpc,ctr,actions,cost_per_action_type,reach';
    var fbPath = '/v19.0/' + FB_AD_ACCOUNT + '/insights?fields=' + encodeURIComponent(fields)
      + '&' + timeRange
      + timeIncrement
      + '&access_token=' + FB_TOKEN;

    var fbOptions = {
      hostname: 'graph.facebook.com',
      path: fbPath,
      method: 'GET'
    };

    var fbReq = https.request(fbOptions, function(fbRes) {
      var data = '';
      fbRes.on('data', function(c){ data += c; });
      fbRes.on('end', function(){
        try {
          var parsed = JSON.parse(data);
          if (parsed.error) {
            console.error('FB API error:', parsed.error.message);
            res.writeHead(400); res.end(JSON.stringify({success: false, error: parsed.error.message}));
            return;
          }
          var insights = parsed.data && parsed.data[0] ? parsed.data[0] : {};
          // Mode by_day : retourner toutes les données journalières
          if (byDay) {
            var days = (parsed.data || []).map(function(day) {
              var dayLeads = 0, dayCpl = null;
              if (day.actions) day.actions.forEach(function(a){ if(a.action_type==='lead'||a.action_type==='leadgen_grouped') dayLeads=parseInt(a.value)||0; });
              if (day.cost_per_action_type) day.cost_per_action_type.forEach(function(a){ if(a.action_type==='lead'||a.action_type==='leadgen_grouped') dayCpl=parseFloat(a.value).toFixed(2); });
              return {
                date:        day.date_start,
                spend:       parseFloat(day.spend||0).toFixed(2),
                impressions: parseInt(day.impressions||0),
                clicks:      parseInt(day.clicks||0),
                leads:       dayLeads,
                ctr:         parseFloat(day.ctr||0).toFixed(2),
                cpc:         parseFloat(day.cpc||0).toFixed(2),
                costPerLead: dayCpl || (dayLeads>0?(parseFloat(day.spend||0)/dayLeads).toFixed(2):null)
              };
            });
            res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
            res.end(JSON.stringify({success: true, period: datePreset||(since+' → '+until), days: days}));
            return;
          }
          // Extraire le coût par lead (action type = lead)
          var costPerLead = null;
          var leads = 0;
          if (insights.cost_per_action_type) {
            insights.cost_per_action_type.forEach(function(a){
              if(a.action_type === 'lead' || a.action_type === 'leadgen_grouped') {
                costPerLead = parseFloat(a.value).toFixed(2);
              }
            });
          }
          if (insights.actions) {
            insights.actions.forEach(function(a){
              if(a.action_type === 'lead' || a.action_type === 'leadgen_grouped') {
                leads = parseInt(a.value) || 0;
              }
            });
          }
          var result = {
            success: true,
            period: datePreset || (since + ' → ' + until),
            spend:        parseFloat(insights.spend || 0).toFixed(2),
            impressions:  parseInt(insights.impressions || 0),
            clicks:       parseInt(insights.clicks || 0),
            reach:        parseInt(insights.reach || 0),
            cpm:          parseFloat(insights.cpm || 0).toFixed(2),
            cpc:          parseFloat(insights.cpc || 0).toFixed(2),
            ctr:          parseFloat(insights.ctr || 0).toFixed(2),
            leads:        leads,
            costPerLead:  costPerLead || (leads > 0 ? (parseFloat(insights.spend || 0) / leads).toFixed(2) : null)
          };
          console.log('FB stats récupérées:', result.period, '| Dépenses:', result.spend, '€ | Coût/lead:', result.costPerLead, '€');
          res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
          res.end(JSON.stringify(result));
        } catch(e) {
          console.error('FB stats parse error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
        }
      });
    });
    fbReq.on('error', function(e){
      console.error('FB stats req error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
    });
    fbReq.end();
    return;
  }

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
    var axS={hostname:'app.axonaut.com',family:4,lookup:axonautLookup,path:'/api/v1/quotations?limit=200',method:'GET',headers:{'apiKey':AXONAUT_KEY}};
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

  // ═══ PROXY LEAD MAIL (évite d'exposer les URLs Zapier côté client) ═══
  if (req.url.startsWith('/lead-mail') && req.method === 'POST') {
    var mailNum = req.url === '/lead-mail2' ? 2 : 1;
    var hookUrl = mailNum === 1 ? (process.env.ZAP_LEAD_MAIL1 || 'https://hooks.zapier.com/hooks/catch/21452394/4bn92rb/')
                                : (process.env.ZAP_LEAD_MAIL2 || 'https://hooks.zapier.com/hooks/catch/21452394/4bn9rns/');
    parseBody(req).then(function(body) {
      body = sanitizeBody(body, {client:100, email:100, tel:20});
      sendZapierNotif(hookUrl, {client: body.client || '', email: body.email || '', tel: body.tel || ''});
      res.writeHead(200); res.end(JSON.stringify({success: true}));
    }).catch(function(e){ res.writeHead(200); res.end(JSON.stringify({error: e.message})); });
    return;
  }

  // ═══════════════════════════════════════
  // ROUTES: ESPACE COLLABORATEUR
  // ═══════════════════════════════════════

  // POST /collab-login — authentification collaborateur
  if (req.url === '/collab-login' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var email = (body.email || '').toLowerCase().trim();
      var mdp   = body.mdp || '';
      if (!email || !mdp) {
        res.writeHead(400); res.end(JSON.stringify({success: false, error: 'Email et mot de passe requis'}));
        return;
      }
      // Chercher le collaborateur par email dans Firestore
      firestoreQueryIn('collaborateurs', 'email', email).then(function(collab) {
        if (!collab) {
          console.log('collab-login: email non trouvé:', email);
          res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Identifiants incorrects'}));
          return;
        }
        var collabData = collab.data || {};
        var storedMdp = collabData.mdp || '';
        var statut    = collabData.statut || 'actif';
        console.log('collab-login: data brute mdp type:', typeof collabData.mdp, '| valeur:', JSON.stringify(collabData.mdp));
        console.log('collab-login: email trouvé', email, '| statut:', statut, '| mdp match:', storedMdp === mdp);
        if (storedMdp !== mdp) {
          res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Identifiants incorrects'}));
          return;
        }
        if (statut !== 'actif') {
          res.writeHead(403); res.end(JSON.stringify({success: false, error: 'Compte désactivé'}));
          return;
        }
        var token = 'collab_' + collab.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        firestoreUpdateIn('collaborateurs', collab.id, {
          sessionToken: token,
          lastLogin: new Date().toISOString()
        }).then(function() {
          var nom = collabData.nom || '';
          var societe = collabData.societe || '';
          res.writeHead(200); res.end(JSON.stringify({success: true, token: token, collabId: collab.id, nom: nom, societe: societe, email: email}));
        });
      }).catch(function(e) {
        res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message}));
      });
    });
    return;
  }

  // POST /collab-change-password — changement de mot de passe
  if (req.url === '/collab-change-password' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var token  = body.token || '';
      var oldMdp = body.oldMdp || '';
      var newMdp = body.newMdp || '';
      if (!token || !oldMdp || !newMdp || newMdp.length < 6) {
        res.writeHead(400); res.end(JSON.stringify({success: false, error: 'Données invalides'}));
        return;
      }
      collabFromToken(token).then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
        var storedMdp = collab.data.mdp || '';
        if (storedMdp !== oldMdp) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Ancien mot de passe incorrect'})); return; }
        return firestoreUpdateIn('collaborateurs', collab.id, {mdp: newMdp, updatedAt: new Date().toISOString()}).then(function() {
          res.writeHead(200); res.end(JSON.stringify({success: true}));
        });
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    });
    return;
  }

  // GET /collab-dashboard — données tableau de bord collaborateur
  if (req.url.startsWith('/collab-dashboard') && req.method === 'GET') {
    var token = new URL('http://localhost' + req.url).searchParams.get('token');
    collabFromToken(token).then(function(collab) {
      if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
      var collabId = collab.id;
      // Récupérer les demandes et tickets SAV
      Promise.all([
        firestoreQueryAllIn('demandes', 'collaborateurId', collabId),
        firestoreQueryAllIn('tickets_sav', 'collaborateurId', collabId)
      ]).then(function(results) {
        var demandes = results[0] || [];
        var tickets  = results[1] || [];
        // Compléter chaque demande avec le devis de son dossier
        // Photos du collaborateur, sans les données binaires
        var photosParCible = {};
        var pPhotos = agentDb
          ? agentDb.collection('demande_photos').where('collaborateurId', '==', collabId).get().then(function(snap) {
              snap.forEach(function(doc) {
                var p = doc.data(), cle = p.demandeId || p.ticketId;
                if (!cle) return;
                (photosParCible[cle] = photosParCible[cle] || []).push({ id: doc.id, url: p.url || null, nom: p.nom || '', at: p.at || '' });
              });
            }).catch(function(e){ console.log('photos : ' + e.message); })
          : Promise.resolve();

        return pPhotos.then(function(){ return Promise.all(demandes.map(function(dem) {
          if (dem.devisPdfData) { delete dem.devisPdfData; dem.devisPdfDispo = true; }  // trop lourd : servi par /collab-devis
          dem.photos = (photosParCible[dem.id] || []);
          if (!dem.dossierId) return Promise.resolve(dem);
          return firestoreGetIn('dossiers', dem.dossierId).then(function(doc) {
            if (doc && doc.data) {
              var dd = doc.data;
              if (dd.devisUrl) dem.devisUrl = dd.devisUrl;
              if (dd.montant)  dem.devisMontant = dd.montant;   // le devis Axonaut fait foi
              else if (dem.devisMontant) dem.devisMontant = dem.devisMontant;
              if (dd.ref)      dem.devisRef = dd.ref;
              if (dd.statut)   dem.statutDossier = dd.statut;
            }
            return dem;
          }).catch(function(){ return dem; });
        })); }).then(function(demandesCompletes) {
          demandes = demandesCompletes;
          tickets.forEach(function(tk){ tk.photos = photosParCible[tk.id] || []; });
          return { demandes: demandes, tickets: tickets };
        }).then(function(r) {
          demandes = r.demandes; tickets = r.tickets;
          console.log('collab-dashboard:', collabId, '| demandes:', demandes.length, '| tickets:', tickets.length);
          res.writeHead(200); res.end(JSON.stringify({success: true, demandes: demandes, tickets: tickets}));
        });
      });
    }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    return;
  }

  // POST /collab-demande — créer une demande d'installation
  if (req.url === '/collab-demande' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var token = body.token || '';
      collabFromToken(token).then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
        var demande = {
          collaborateurId: collab.id,
          societe:         collab.data.societe && collab.data.societe.stringValue ? collab.data.societe.stringValue : (collab.data.societe || ''),
          client:          body.client || '',
          vehicule:        body.vehicule || '',
          email:           body.email || '',
          tel:             body.tel || '',
          adresse:         body.adresse || '',
          cp:              body.cp || '',
          ville:           body.ville || '',
          delai:           body.delai || '',
          livraison:       body.livraison || '',
          notes:           body.notes || '',
          statut:          'en_attente',
          createdAt:       new Date().toISOString(),
          updatedAt:       new Date().toISOString()
        };
        return firestoreCreateIn('demandes', demande).then(function(result) {
          res.writeHead(200); res.end(JSON.stringify({success: true, id: result && result.name ? result.name.split('/').pop() : null}));
        });
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    });
    return;
  }


  // ── PHOTOS DES DEMANDES ET TICKETS (espace collaborateur) ──
  // POST /collab-photo  { token, demandeId|ticketId, dataBase64, contentType, nom }
  if (req.url === '/collab-photo' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      collabFromToken(body.token || '').then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success:false, error:'Session invalide'})); return; }
        if (!agentDb) { res.writeHead(503); res.end(JSON.stringify({success:false, error:'Service photos indisponible'})); return; }
        var ct = String(body.contentType || 'image/jpeg');
        if (!/^image\/(jpeg|png|webp)$/.test(ct)) { res.writeHead(400); res.end(JSON.stringify({success:false, error:'Format accepté : jpeg, png, webp'})); return; }
        var buf = Buffer.from(String(body.dataBase64 || '').replace(/^data:[^,]+,/, ''), 'base64');
        if (buf.length < 500)            { res.writeHead(400); res.end(JSON.stringify({success:false, error:'Image vide'})); return; }
        if (buf.length > 900 * 1024)     { res.writeHead(413); res.end(JSON.stringify({success:false, error:'Image trop lourde (900 Ko max)'})); return; }
        var cible = body.demandeId ? {champ:'demandeId', id:String(body.demandeId)} : (body.ticketId ? {champ:'ticketId', id:String(body.ticketId)} : null);
        if (!cible) { res.writeHead(400); res.end(JSON.stringify({success:false, error:'demandeId ou ticketId requis'})); return; }

        var doc = { collaborateurId: collab.id, nom: String(body.nom || 'photo.jpg').slice(0,80),
                    contentType: ct, taille: buf.length, at: new Date().toISOString() };
        doc[cible.champ] = cible.id;

        // Firebase Storage si disponible, sinon stockage direct dans Firestore
        var prep = Promise.resolve();
        if (agentBucket) {
          var chemin = 'collab/' + cible.id + '_' + Date.now() + '.' + (/png/.test(ct) ? 'png' : 'jpg');
          var token = require('crypto').randomUUID();
          prep = agentBucket.file(chemin).save(buf, { resumable:false, metadata:{ contentType: ct, metadata:{ firebaseStorageDownloadTokens: token } } })
            .then(function(){ doc.url = 'https://firebasestorage.googleapis.com/v0/b/' + agentBucket.name + '/o/' + encodeURIComponent(chemin) + '?alt=media&token=' + token; })
            .catch(function(e){ console.log('Storage indisponible, repli Firestore :', e.message); doc.data = buf.toString('base64'); });
        } else {
          doc.data = buf.toString('base64');
        }

        prep.then(function(){ return agentDb.collection('demande_photos').add(doc); })
          .then(function(ref){
            console.log('Photo collaborateur enregistrée :', ref.id, cible.champ, cible.id);
            res.writeHead(200); res.end(JSON.stringify({success:true, id:ref.id, url: doc.url || null}));
          }).catch(function(e){ res.writeHead(500); res.end(JSON.stringify({success:false, error:e.message})); });
      }).catch(function(e){ res.writeHead(500); res.end(JSON.stringify({success:false, error:e.message})); });
    });
    return;
  }

  // GET /collab-photo?token=...&id=...  → renvoie l'image stockée dans Firestore
  if (req.url.startsWith('/collab-photo') && req.method === 'GET') {
    var qsP = new URL('http://localhost' + req.url).searchParams;
    collabFromToken(qsP.get('token') || '').then(function(collab) {
      if (!collab || !agentDb) { res.writeHead(401); res.end('Non autorisé'); return; }
      return agentDb.collection('demande_photos').doc(qsP.get('id') || '-').get().then(function(snap) {
        if (!snap.exists) { res.writeHead(404); res.end('Photo introuvable'); return; }
        var p = snap.data();
        if (p.collaborateurId !== collab.id) { res.writeHead(403); res.end('Non autorisé'); return; }
        if (p.url) { res.writeHead(302, {Location: p.url}); res.end(); return; }
        var img = Buffer.from(p.data || '', 'base64');
        res.writeHead(200, {'Content-Type': p.contentType || 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'private, max-age=3600'});
        res.end(img);
      });
    }).catch(function(e){ res.writeHead(500); res.end(e.message); });
    return;
  }

  // GET /collab-devis?token=...&demandeId=...  → renvoie le PDF stocké sur la demande
  if (req.url.startsWith('/collab-devis') && req.method === 'GET') {
    var qs = new URL('http://localhost' + req.url).searchParams;
    var tokenDevis = qs.get('token'), demDevis = qs.get('demandeId');
    collabFromToken(tokenDevis).then(function(collab) {
      if (!collab || !demDevis) { res.writeHead(401); res.end('Non autorisé'); return; }
      return firestoreGetIn('demandes', demDevis).then(function(doc) {
        if (!doc || !doc.data) { res.writeHead(404); res.end('Devis introuvable'); return; }
        if (doc.data.collaborateurId !== collab.id) { res.writeHead(403); res.end('Non autorisé'); return; }
        var b64 = doc.data.devisPdfData || '';
        if (!b64) { res.writeHead(404); res.end('Aucun devis'); return; }
        var buf = Buffer.from(b64, 'base64');
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': buf.length,
          'Content-Disposition': 'inline; filename="' + (doc.data.devisPdfNom || 'devis.pdf') + '"'
        });
        res.end(buf);
      });
    }).catch(function(e){ res.writeHead(500); res.end(e.message); });
    return;
  }

  // POST /collab-demande-update — modifier une demande en_attente
  if (req.url === '/collab-demande-update' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var token     = body.token || '';
      var demandeId = body.demandeId || '';
      if (!demandeId) { res.writeHead(400); res.end(JSON.stringify({success: false, error: 'demandeId manquant'})); return; }
      collabFromToken(token).then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
        return firestoreGetIn('demandes', demandeId).then(function(doc) {
          if (!doc) { res.writeHead(404); res.end(JSON.stringify({success: false, error: 'Demande introuvable'})); return; }
          var collabId = doc.data.collaborateurId || '';
          if (collabId !== collab.id) { res.writeHead(403); res.end(JSON.stringify({success: false, error: 'Non autorisé'})); return; }
          if (doc.data.statut !== 'en_attente') { res.writeHead(400); res.end(JSON.stringify({success: false, error: 'Seules les demandes en attente peuvent être modifiées'})); return; }
          var update = {
            client:    body.client    || '',
            vehicule:  body.vehicule  || '',
            email:     body.email     || '',
            tel:       body.tel       || '',
            adresse:   body.adresse   || '',
            cp:        body.cp        || '',
            ville:     body.ville     || '',
            delai:     body.delai     || '',
            livraison: body.livraison || '',
            notes:     body.notes     || '',
            updatedAt: new Date().toISOString()
          };
          return firestoreUpdateIn('demandes', demandeId, update).then(function() {
            console.log('Demande modifiée:', demandeId, '| collab:', collab.id);
            res.writeHead(200); res.end(JSON.stringify({success: true}));
          });
        });
      }).catch(function(e){ res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    });
    return;
  }

  // POST /collab-demande-cloture — clôturer une demande terminée
  if (req.url === '/collab-demande-cloture' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var token     = body.token || '';
      var demandeId = body.demandeId || '';
      if (!demandeId) { res.writeHead(400); res.end(JSON.stringify({success: false, error: 'demandeId manquant'})); return; }
      collabFromToken(token).then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
        // Vérifier que la demande appartient bien à ce collaborateur
        return firestoreGetIn('demandes', demandeId).then(function(doc) {
          if (!doc) { res.writeHead(404); res.end(JSON.stringify({success: false, error: 'Demande introuvable'})); return; }
          var collabId = doc.data.collaborateurId && doc.data.collaborateurId.stringValue ? doc.data.collaborateurId.stringValue : (doc.data.collaborateurId || '');
          if (collabId !== collab.id) { res.writeHead(403); res.end(JSON.stringify({success: false, error: 'Non autorisé'})); return; }
          return firestoreUpdateIn('demandes', demandeId, {statut: 'cloture', updatedAt: new Date().toISOString()}).then(function() {
            console.log('Demande clôturée:', demandeId, '| collab:', collab.id);
            res.writeHead(200); res.end(JSON.stringify({success: true}));
          });
        });
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    });
    return;
  }

  // POST /collab-ticket — créer un ticket SAV
  if (req.url === '/collab-ticket' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var token = body.token || '';
      collabFromToken(token).then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
        var ticket = {
          collaborateurId: collab.id,
          societe:         collab.data.societe && collab.data.societe.stringValue ? collab.data.societe.stringValue : (collab.data.societe || ''),
          demandeId:       body.demandeId || '',
          sujet:           body.sujet || '',
          description:     body.description || '',
          statut:          'ouvert',
          createdAt:       new Date().toISOString(),
          updatedAt:       new Date().toISOString()
        };
        return firestoreCreateIn('tickets_sav', ticket).then(function(result) {
          res.writeHead(200); res.end(JSON.stringify({success: true, id: result && result.name ? result.name.split('/').pop() : null}));
        });
      }).catch(function(e) { res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    });
    return;
  }

  // POST /collab-update-profil — mettre à jour le profil de la société
  if (req.url === '/collab-update-profil' && req.method === 'POST') {
    parseBody(req).then(function(body) {
      var token = body.token || '';
      collabFromToken(token).then(function(collab) {
        if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false, error: 'Session invalide'})); return; }
        var update = {updatedAt: new Date().toISOString()};
        if (body.societe !== undefined) update.societe = body.societe;
        if (body.nom     !== undefined) update.nom     = body.nom;
        if (body.siret   !== undefined) update.siret   = body.siret;
        if (body.tel     !== undefined) update.tel     = body.tel;
        if (body.adresse !== undefined) update.adresse = body.adresse;
        return firestoreUpdateIn('collaborateurs', collab.id, update).then(function() {
          console.log('Profil mis à jour:', collab.id, body.societe);
          res.writeHead(200); res.end(JSON.stringify({success: true}));
        });
      }).catch(function(e){ res.writeHead(500); res.end(JSON.stringify({success: false, error: e.message})); });
    });
    return;
  }

  // GET /collab-verify — vérifier si le token de session est valide
  if (req.url.startsWith('/collab-verify') && req.method === 'GET') {
    var token = new URL('http://localhost' + req.url).searchParams.get('token');
    collabFromToken(token).then(function(collab) {
      if (!collab) { res.writeHead(401); res.end(JSON.stringify({success: false})); return; }
      var nom     = collab.data.nom     || '';
      var societe = collab.data.societe || '';
      var siret   = collab.data.siret   || '';
      var tel     = collab.data.tel     || '';
      var adresse = collab.data.adresse || '';
      res.writeHead(200); res.end(JSON.stringify({success: true, collabId: collab.id, nom: nom, societe: societe, siret: siret, tel: tel, adresse: adresse}));
    }).catch(function() { res.writeHead(401); res.end(JSON.stringify({success: false})); });
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({error: 'Route inconnue'}));
});

// ============================================================
// EKWATEUR — Cron: bascule auto en "termine" les pre-visites dont le RDV est passe
// (pas de mail de rapport pour la pre-visite, donc verification periodique)
// ============================================================
function checkEkwateurPreVisitesExpirees() {
  firestoreListIn('ekwateur_dossiers').then(function(docs) {
    var now = new Date();
    docs.forEach(function(doc) {
      var d = decodeFirestoreFields(doc.data);
      if (d.type !== 'previsite') return;
      if (d.statut !== 'rdv_fixe') return;
      if (!d.rdv) return;
      // Format attendu: "DD/MM/YYYY HH:MM"
      var m = String(d.rdv).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
      if (!m) return;
      var rdvDate = new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5]));
      if (isNaN(rdvDate.getTime())) return;
      if (rdvDate.getTime() < now.getTime()) {
        firestoreUpdateIn('ekwateur_dossiers', doc.id, {
          statut: 'termine',
          updatedAt: new Date().toISOString()
        }).then(function() {
          console.log('Ekwateur pre-visite auto-terminee (RDV passe):', d.idEkwateur, d.client);
        });
      }
    });
  }).catch(function(e) { console.error('checkEkwateurPreVisitesExpirees error:', e.message); });
}
// Verification toutes les 30 minutes
setInterval(checkEkwateurPreVisitesExpirees, 30 * 60000);
// Premiere verification 1 minute apres le demarrage du serveur
setTimeout(checkEkwateurPreVisitesExpirees, 60000);

// ============================================================
// RÉCUPÉRATION AU DÉMARRAGE — devisUrl manquants sur dossiers récents
// Compense les pertes de webhooks pendant les redémarrages Render
// ============================================================
function recoverMissingDevisUrl(attempt) {
  attempt = attempt || 1;
  if (attempt > 4) { console.log('recoverMissingDevisUrl: abandon après 4 tentatives'); return; }
  console.log('Récupération devisUrl manquants... (tentative ' + attempt + '/4)');
  // Récupérer les devis Axonaut récents (dernières 48h)
  var axOpts = {
    hostname: 'app.axonaut.com', family: 4, lookup: axonautLookup,
    path: '/api/v1/quotations?limit=50',
    method: 'GET',
    headers: { 'apiKey': AXONAUT_KEY }
  };
  var r = https.request(axOpts, function(res) {
    var d = '';
    res.on('data', function(c){ d += c; });
    res.on('end', function(){
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.log('recoverMissingDevisUrl: Axonaut HTTP', res.statusCode);
        return;
      }
      try {
        var quotations = JSON.parse(d);
        var cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48h
        var recent = quotations.filter(function(q) {
          var created = new Date(q.created_at || q.date || 0).getTime();
          return created > cutoff;
        });
        console.log('recoverMissingDevisUrl: ' + recent.length + ' devis récents trouvés');
        recent.forEach(function(q) {
          if (!q.company_id || !q.customer_portal_url) return;
          // Chercher le dossier dans Firestore
          firestoreQuery('axonautId', String(q.company_id)).then(function(fsDoc) {
            if (!fsDoc) return;
            var isDeleted = fsDoc.data && fsDoc.data.deleted && fsDoc.data.deleted.booleanValue === true;
            if (isDeleted) return;
            // Vérifier si devisUrl est absent
            var existingUrl = fsDoc.data && fsDoc.data.devisUrl && (fsDoc.data.devisUrl.stringValue || '');
            if (!existingUrl && q.customer_portal_url) {
              console.log('recoverMissingDevisUrl: mise à jour devisUrl pour', q.company_name, q.customer_portal_url);
              firestoreUpdate(fsDoc.id, {
                devisUrl: q.customer_portal_url,
                updatedAt: new Date().toISOString()
              });
            }
          }).catch(function(){});
        });
      } catch(e) { console.log('recoverMissingDevisUrl parse error:', e.message); }
    });
  });
  r.on('error', function(e){
    console.log('recoverMissingDevisUrl error:', e.message);
    if ((e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') && attempt < 4) {
      var delay = attempt * 3 * 60000; // 3min, 6min, 9min
      console.log('recoverMissingDevisUrl: retry dans ' + (delay/60000) + 'min...');
      setTimeout(function(){ recoverMissingDevisUrl(attempt + 1); }, delay);
    }
  });
  r.end();
}
// Lancer 5 minutes après le démarrage pour laisser le réseau se stabiliser
setTimeout(recoverMissingDevisUrl, 15 * 60000); // Attendre 15min après démarrage pour laisser DNS se stabiliser
// Relancer toutes les 6 heures
setInterval(recoverMissingDevisUrl, 6 * 60 * 60000);

server.listen(PORT, function() {
  console.log('PowerRecharge API v9.1 demarree sur port', PORT);
});
