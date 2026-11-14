// Abgleich zwischen Geräten über Firebase Firestore.
// Alle Geräte mit demselben Code teilen sich ein Dokument „haushalte/<code>“.
// Konflikte werden pro Artikel/Liste/Preis über den Zeitstempel aufgelöst (siehe merge in app.js).

const FIREBASE_VERSION = '11.0.2';
const BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;

export function createSync({ config, getState, applyRemote, onStatus }) {
  let fs = null;
  let db = null;
  let docRef = null;
  let unsub = null;
  let timer = null;
  let pushing = false;
  let pendingPush = false;

  async function init() {
    if (fs) return;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(BASE + 'firebase-app.js'),
      import(BASE + 'firebase-auth.js'),
      import(BASE + 'firebase-firestore.js'),
    ]);
    const app = appMod.initializeApp(config);
    await authMod.signInAnonymously(authMod.getAuth(app));
    db = fsMod.getFirestore(app);
    fs = fsMod;
  }

  async function connect(code) {
    disconnect();
    onStatus('connecting');
    try {
      await init();
    } catch (e) {
      onStatus('error', 'Verbindung fehlgeschlagen: ' + e.message);
      return;
    }
    docRef = fs.doc(db, 'haushalte', code);
    unsub = fs.onSnapshot(
      docRef,
      (snap) => {
        onStatus('online');
        if (snap.exists()) {
          const needsPush = applyRemote(JSON.parse(snap.data().data));
          if (needsPush) schedule();
        } else {
          schedule(0);
        }
      },
      (err) => onStatus('error', err.message)
    );
  }

  function schedule(delay = 600) {
    if (!docRef) return;
    clearTimeout(timer);
    timer = setTimeout(push, delay);
  }

  async function push() {
    if (!docRef) return;
    if (pushing) { pendingPush = true; return; }
    pushing = true;
    try {
      const ref = docRef;
      await fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) applyRemote(JSON.parse(snap.data().data));
        tx.set(ref, { data: JSON.stringify(getState()), geaendert: fs.serverTimestamp() });
      });
    } catch (e) {
      onStatus('error', 'Speichern fehlgeschlagen: ' + e.message);
    } finally {
      pushing = false;
      if (pendingPush) { pendingPush = false; push(); }
    }
  }

  function disconnect() {
    clearTimeout(timer);
    if (unsub) unsub();
    unsub = null;
    docRef = null;
    onStatus('off');
  }

  return { connect, schedule, disconnect };
}
