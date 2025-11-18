import { firestore } from '../src/lib/firebase';

async function seedPlans() {
  const plans = [
    { id: 'free', name: 'Free', price: 0, limits: { leadsPerMo: 50, msgsPerMo: 500, seats: 1 } },
    { id: 'pro', name: 'Pro', price: 199, limits: { leadsPerMo: 500, msgsPerMo: 5000, seats: 5 } },
    { id: 'enterprise', name: 'Enterprise', price: 999, limits: { leadsPerMo: 5000, msgsPerMo: 50000, seats: 25 } },
  ];
  await Promise.all(
    plans.map(plan =>
      firestore
        .collection('plans')
        .doc(plan.id)
        .set({
          name: plan.name,
          price: plan.price,
          limits: plan.limits,
          features: {
            leadGen: true,
            crm: true,
            support: true,
            booking: true,
            outbound: plan.id !== 'free',
          },
        }),
    ),
  );
}

async function seedDemoOrg() {
  const orgRef = firestore.collection('orgs').doc('demo');
  await orgRef.set({
    name: 'Dott Demo Org',
    plan: 'Pro',
    locale: { lang: 'en', tz: 'Africa/Kampala', currency: 'UGX' },
    createdAt: Date.now(),
    ownerUid: 'demo-owner',
  });
  await firestore
    .collection('orgUsers')
    .doc('demo_demo-owner')
    .set({ orgId: 'demo', uid: 'demo-owner', role: 'Owner', createdAt: Date.now() });
  await firestore.collection('orgSettings').doc('demo').set({
    channels: {
      whatsapp: { enabled: false },
      instagram: { enabled: false },
      facebook: { enabled: false },
      linkedin: { enabled: false },
      web: { enabled: true },
    },
    features: {
      leadGen: true,
      crm: true,
      support: true,
      booking: true,
      outbound: true,
      contentEngagement: true,
      retargeting: true,
    },
    booking: { provider: 'google' },
    knowledgeBase: { sources: [] },
    webWidget: { theme: 'dott', accent: '#FF7A00', position: 'right' },
  });
}

async function run() {
  await seedPlans();
  await seedDemoOrg();
  console.log('Admin seed completed');
  process.exit(0);
}

run().catch(error => {
  console.error('Seed failed', error);
  process.exit(1);
});
