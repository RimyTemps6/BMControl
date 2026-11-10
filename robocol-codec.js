// Codec Robocol v124 - formatos copiados do SDK FTC 11.1 (RobotCore). Tudo big-endian.
// Cabecalho: tipo(1) + tamanho_payload(2) + sequencia(2)
const TYPE = { EMPTY: 0, HEARTBEAT: 1, GAMEPAD: 2, PEER_DISCOVERY: 3, COMMAND: 4, TELEMETRY: 5, KEEPALIVE: 6 };
const STATE = { UNKNOWN: -1, NOT_STARTED: 0, INIT: 1, RUNNING: 2, STOPPED: 3, EMERGENCY_STOP: 4 };
const VERSION = 124, PORT = 20884;
let seq = 0;
const nextSeq = () => (seq++) & 0xFFFF;

function withHeader(type, payload, s = nextSeq()) {
  const h = Buffer.alloc(5);
  h.writeUInt8(type, 0); h.writeUInt16BE(payload.length, 1); h.writeUInt16BE(s, 3);
  return Buffer.concat([h, payload]);
}

function peerDiscovery(peerType = 1) {            // 1 = PEER
  const b = Buffer.alloc(13), d = new Date();
  b.writeUInt8(TYPE.PEER_DISCOVERY, 0); b.writeUInt16BE(10, 1);
  b.writeUInt8(VERSION, 3); b.writeUInt8(peerType, 4); b.writeUInt16BE(nextSeq(), 5);
  b.writeUInt8(d.getMonth() + 1, 7); b.writeUInt16BE(d.getFullYear(), 8);
  b.writeUInt8(11, 10); b.writeUInt8(1, 11);      // SDK 11.1
  return b;
}

function heartbeat(state = STATE.NOT_STARTED) {
  const tz = Buffer.from(Intl.DateTimeFormat().resolvedOptions().timeZone, 'utf8');
  const p = Buffer.alloc(8 + 1 + 24 + 1 + tz.length);
  p.writeBigInt64BE(process.hrtime.bigint() & 0x7FFFFFFFFFFFFFFFn, 0);
  p.writeInt8(state, 8);                           // t0,t1,t2 = 0
  p.writeUInt8(tz.length, 33); tz.copy(p, 34);
  return withHeader(TYPE.HEARTBEAT, p);
}

function command(name, extra = '', ack = false, ts = process.hrtime.bigint() & 0x7FFFFFFFFFFFFFFFn) {
  const n = Buffer.from(name, 'utf8'), e = Buffer.from(extra, 'utf8');
  const parts = [Buffer.alloc(9), Buffer.alloc(2), n];
  parts[0].writeBigInt64BE(ts, 0); parts[0].writeUInt8(ack ? 1 : 0, 8);
  parts[1].writeUInt16BE(n.length, 0);
  if (!ack) { const l = Buffer.alloc(2); l.writeUInt16BE(e.length, 0); parts.push(l, e); }
  return withHeader(TYPE.COMMAND, Buffer.concat(parts));
}

function parseCommand(buf) {
  let o = 5; const ts = buf.readBigInt64BE(o); o += 8; const ack = buf.readUInt8(o++) !== 0;
  const nl = buf.readUInt16BE(o); o += 2; const name = buf.toString('utf8', o, o + nl); o += nl;
  let extra = '';
  if (!ack) { const el = buf.readUInt16BE(o); o += 2; extra = buf.toString('utf8', o, o + el); }
  return { ts, ack, name, extra };
}

// Bits dos botoes (bit0 = right_bumper ... bit17 = touchpad_finger_1), ordem do Gamepad.toByteArray
const BTN = ['right_bumper','left_bumper','back','start','guide','y','x','b','a','dpad_right','dpad_left','dpad_down','dpad_up',
  'right_stick_button','left_stick_button','touchpad','touchpad_finger_2','touchpad_finger_1'];
function gamepad(g, user, id = 0, legacyType = 0, type = 0) {   // legacyType/type: confirmar enum no SDK
  const p = Buffer.alloc(60); let o = 0;
  p.writeUInt8(5, o++);                              // ROBOCOL_GAMEPAD_VERSION
  p.writeInt32BE(id, o); o += 4;
  p.writeBigInt64BE(BigInt(Math.floor(process.uptime() * 1000)), o); o += 8;
  for (const k of ['left_stick_x','left_stick_y','right_stick_x','right_stick_y','left_trigger','right_trigger']) { p.writeFloatBE(g[k] || 0, o); o += 4; }
  let bits = 0; BTN.forEach((k, i) => { if (g[k]) bits |= (1 << i); });
  p.writeInt32BE(bits, o); o += 4;
  p.writeUInt8(user, o++); p.writeUInt8(legacyType, o++); p.writeUInt8(type, o++);
  return withHeader(TYPE.GAMEPAD, p);                // 4 floats do touchpad ficam 0
}

function parseTelemetry(buf) {
  let o = 5 + 8; const sorted = buf.readUInt8(o++) !== 0; const state = buf.readInt8(o++);
  const tl = buf.readUInt8(o++); const tag = buf.toString('utf8', o, o + tl); o += tl;
  const strings = {}, numbers = {};
  let n = buf.readUInt8(o++);
  for (let i = 0; i < n; i++) {
    const kl = buf.readUInt16BE(o); o += 2; const k = buf.toString('utf8', o, o + kl); o += kl;
    const vl = buf.readUInt16BE(o); o += 2; strings[k] = buf.toString('utf8', o, o + vl); o += vl;
  }
  n = buf.readUInt8(o++);
  for (let i = 0; i < n; i++) {
    const kl = buf.readUInt16BE(o); o += 2; const k = buf.toString('utf8', o, o + kl); o += kl;
    numbers[k] = buf.readFloatBE(o); o += 4;
  }
  return { tag, sorted, state, strings, numbers };
}

function parse(buf) {
  const type = buf.readUInt8(0);
  if (type === TYPE.COMMAND) return { type: 'command', ...parseCommand(buf) };
  if (type === TYPE.TELEMETRY) return { type: 'telemetry', ...parseTelemetry(buf) };
  if (type === TYPE.HEARTBEAT) return { type: 'heartbeat', state: buf.readInt8(5 + 8) };
  return { type: Object.keys(TYPE).find(k => TYPE[k] === type) || 'unknown' };
}

module.exports = { TYPE, STATE, PORT, VERSION, peerDiscovery, heartbeat, command, gamepad, parse };
