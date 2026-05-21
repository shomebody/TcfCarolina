const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID || 'tcf-22'
});
const db = getFirestore();

async function run() {
  const pSnap = await db.collection('players').get();
  const players = pSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const anthonyPlayer = players.find(p => (p.name || '').toLowerCase().includes('anthony') || (p.displayName || '').toLowerCase().includes('anthony'));
  if (anthonyPlayer) {
     console.log("Player Anthony:", anthonyPlayer);
     return;
  }
}
run();
