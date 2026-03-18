import { NextResponse } from 'next/server';
import { initializeFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const eventType = body.type;

    // Handle 'checkout.session.completed'
    if (eventType === 'checkout.session.completed') {
      const session = body.data.object;
      const { enrollmentId, userId } = session.metadata;

      if (enrollmentId && userId) {
        const { firestore } = initializeFirebase();
        const enrollmentRef = doc(firestore, 'userProfiles', userId, 'enrollments', enrollmentId);
        
        await updateDoc(enrollmentRef, {
          paymentStatus: 'paid',
          updatedAt: new Date().toISOString()
        });
        
        console.log(`Payment confirmed for enrollment ${enrollmentId}`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
