/* R10: store.emit delivers to a snapshot of the subscribers, so (a) a subscriber unsubscribed during the emit is still called, and (b) a subscriber that
 * writes the store inside its handler makes later subscribers see the newer event BEFORE the older one.
 * Run: node docs/state-machines/repro/r10-store-emit.js */
const H = require('./_harness'), { G } = H;
const s = G.PackStore.create(H.MANIFEST()); const log = [];
let off2; s.subscribe('params', () => off2()); off2 = s.subscribe('params', () => log.push('s2 called after s1 unsubscribed it'));
s.setParam('rate', 0.6); console.log('(a) ' + JSON.stringify(log));
const t = G.PackStore.create(H.MANIFEST()), seen = [];
t.subscribe('params', ev => { if (ev.version === 1) t.setParam('rate', 0.9); });
t.subscribe('params', ev => seen.push('v' + ev.version + ' rate=' + t.param('rate')));
t.setParam('rate', 0.6); console.log('(b) later subscriber saw: ' + JSON.stringify(seen) + ' (event order inverted)');
