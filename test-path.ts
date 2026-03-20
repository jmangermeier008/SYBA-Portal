import { initializeApp } from 'firebase/app';
import { getFirestore, collection, collectionGroup, query, where } from 'firebase/firestore';

const app = initializeApp({ projectId: "demo-test" });
const db = getFirestore(app);

const userProfilesCol = collection(db, 'userProfiles');
const regularQuery = query(userProfilesCol, where('role', '==', 'Admin'));

console.log("Query type:", (regularQuery as any).type);
console.log("Query path:", (regularQuery as any).path);
console.log("Query canonicalString:", (regularQuery as any)._query?.path?.canonicalString());
