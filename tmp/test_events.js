const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID || 'demo-project'
});
const db = getFirestore();

async function run() {
  const chefsSnap = await db.collection('chefs').get();
  const chefs = chefsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const anthony = chefs.find(c => c.name.toLowerCase().includes('anthony'));
  if (!anthony) {
    console.log("No Anthony found.");
    return;
  }
  console.log("Found:", anthony.name);

  const evSnap = await db.collection('scoreEvents').where('chefId', '==', anthony.id).get();
  const evs = evSnap.docs.map(doc => doc.data());
  evs.sort((a,b) => a.week - b.week);
  console.log("Events:", evs);
}
run();
