import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {setGlobalOptions} from 'firebase-functions/v2';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';

initializeApp();
setGlobalOptions({region:'europe-west1',maxInstances:3});

/**
 * Requires Firebase's Trigger Email extension to watch the `mail` collection.
 * The client can create only its own immutable device document; this trusted
 * function resolves the Authentication email and creates the notification.
 */
export const notifyOwnerOfNewDevice=onDocumentCreated('owners/{ownerId}/devices/{deviceId}',async event=>{
  const ownerId=event.params.ownerId;const deviceId=event.params.deviceId;const owner=await getAuth().getUser(ownerId);if(!owner.email)return;await getFirestore().collection('mail').add({to:[owner.email],message:{subject:'New device signed in to DROMEX',text:`A new device (${deviceId}) connected to your DROMEX cloud account. If this was not you, reset the owner password immediately; Firebase will revoke the existing sessions.`,html:`<p>A new device <strong>${deviceId}</strong> connected to your DROMEX cloud account.</p><p>If this was not you, reset the owner password immediately. Firebase will revoke the existing sessions.</p>`}});
});
