#!/usr/bin/env node
/**
 * Generate the VAPID key pair for Web Push.
 *
 * Run once per deployment, then put both values in the host's secret store:
 *
 *   npm run push:keys
 *
 * The public half is sent to every browser that subscribes; the private half
 * signs each push. Treat the private key like a password: anyone holding the pair
 * can send notifications to this site's subscribers. Rotating the pair invalidates
 * every existing subscription — devices simply re-enrol.
 *
 * Nothing is written to disk: this prints to the terminal so the values go where
 * the other secrets go, not into the repository.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('');
console.log('Web Push keys for Heritage Bites — copy these into the host\'s secrets:');
console.log('');
console.log(`HB_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`HB_VAPID_PRIVATE_KEY=${privateKey}`);
console.log('HB_VAPID_SUBJECT=mailto:heritagebitesfood@gmail.com');
console.log('');
console.log('Then pick an owner key — the password that lets a phone or tablet enrol');
console.log('as a kitchen device. Make it long, keep it out of the repository:');
console.log('');
console.log(`HB_OWNER_PUSH_KEY=${randomKey()}`);
console.log('');
console.log('Restart the API, then open /alerts on each device that should buzz.');
console.log('');
console.log('Note: rotating HB_VAPID_* invalidates every existing subscription, so every');
console.log('device must visit /alerts again. Rotating HB_OWNER_PUSH_KEY stops new devices');
console.log('enrolling until the new key is used, but devices already enrolled stay enrolled —');
console.log('remove those from /alerts on the device itself.');
console.log('');

function randomKey() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}
