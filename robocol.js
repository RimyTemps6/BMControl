// Camada de comunicacao com o Robot Controller (RC).
// MODO DEMO: simula um robo para voce testar a interface.
// MODO REAL: implemente RealTransport seguindo o protocolo Robocol do SDK FTC
// (github.com/FIRST-Tech-Challenge/FtcRobotController, pacote com.qualcomm.robotcore.robocol).
const { EventEmitter } = require('events');
const codec = require('./robocol-codec.js');

class DemoTransport extends EventEmitter {
  constructor() { super(); this.t = null; this.v = 12.4; }
  connect() { setTimeout(() => this.emit('connected'), 400); }
  disconnect() { clearInterval(this.t); this.emit('disconnected'); }
  opModes() { return { auto: ['Auto Vermelho', 'Auto Azul'], teleop: ['TeleOp Principal', 'TeleOp Teste'] }; }
  init(name) { this.emit('state', 'INIT'); this.emit('telemetry', `OpMode ${name} inicializado`); }
  start() {
    this.emit('state', 'RUNNING'); let n = 0;
    this.t = setInterval(() => this.emit('telemetry', `loop ${++n} | bateria ${this.v.toFixed(2)}V`), 500);
  }
  stop() { clearInterval(this.t); this.emit('state', 'STOPPED'); }
  gamepad(user, g) { /* enviar estado do controle ao robo */ }
}

class RealTransport extends EventEmitter {
  // Fala com o Robot Controller por UDP (porta 20884), seguindo o SDK FTC 11.1.
  // O Driver Station origina heartbeat a cada 100 ms e gamepads a cada 40 ms.
  constructor(ip = '192.168.43.1') {
    super(); this.ip = ip; this.sock = null; this.timers = []; this.pending = new Map();
    this.state = codec.STATE.NOT_STARTED; this.gp = {}; this.lastRx = 0; this.up = false; this.opNames = { auto: [], teleop: [] };
  }
  connect() {
    const dgram = require('dgram');
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.sock.on('error', e => this.emit('error', e));
    this.sock.on('message', (m, r) => { try { this._rx(m); } catch (e) { this.emit('error', e); } });
    this.sock.bind(codec.PORT, () => {
      this._tx(codec.peerDiscovery(1));
      this.timers.push(setInterval(() => this._tx(codec.peerDiscovery(1)), 1000));
      this.timers.push(setInterval(() => this._tx(codec.heartbeat(this.state)), 100));
      this.timers.push(setInterval(() => { Object.entries(this.gp).forEach(([u, g]) => this._tx(codec.gamepad(g, +u))); }, 40));
      this.timers.push(setInterval(() => this._retry(), 100));
      this.timers.push(setInterval(() => { if (this.up && Date.now() - this.lastRx > 3000) this._down(); }, 500));
    });
  }
  disconnect() { this._down(); this.timers.forEach(clearInterval); this.timers = []; try { this.sock && this.sock.close(); } catch (e) {} this.sock = null; }
  _down() { if (this.up) { this.up = false; this.emit('disconnected'); } }
  _tx(buf) { if (this.sock) this.sock.send(buf, codec.PORT, this.ip); }
  _cmd(name, extra = '') {
    const ts = process.hrtime.bigint() & 0x7FFFFFFFFFFFFFFFn;
    this.pending.set(name + ts, { name, extra, ts, tries: 0 }); this._tx(codec.command(name, extra, false, ts));
  }
  _retry() { for (const [k, c] of this.pending) { if (++c.tries > 20) this.pending.delete(k); else this._tx(codec.command(c.name, c.extra, false, c.ts)); } }
  _rx(buf) {
    this.lastRx = Date.now();
    const m = codec.parse(buf);
    if (!this.up && ['heartbeat', 'command', 'telemetry'].includes(m.type)) {
      this.up = true; this.emit('connected'); this._cmd('CMD_REQUEST_OP_MODE_LIST'); this._cmd('CMD_REQUEST_ACTIVE_CONFIG');
    }
    if (m.type === 'heartbeat' && m.state !== this.state) { this.state = m.state; this.emit('state', Object.keys(codec.STATE).find(k => codec.STATE[k] === m.state)); }
    if (m.type === 'telemetry') Object.entries({ ...m.strings, ...m.numbers }).forEach(([k, v]) => this.emit('telemetry', k ? `${k}: ${v}` : String(v)));
    if (m.type === 'command') {
      if (m.ack) { this.pending.delete(m.name + m.ts); return; }
      this._tx(codec.command(m.name, '', true, m.ts));                     // confirma o recebimento
      if (m.name === 'CMD_NOTIFY_OP_MODE_LIST') this._opList(m.extra);
      else if (m.name === 'CMD_NOTIFY_INIT_OP_MODE') this.emit('state', 'INIT');
      else if (m.name === 'CMD_NOTIFY_RUN_OP_MODE') this.emit('state', 'RUNNING');
      else if (m.name === 'CMD_SHOW_TOAST') this.emit('telemetry', '[robo] ' + m.extra);
    }
  }
  _opList(json) {
    const list = JSON.parse(json).filter(o => o.flavor !== 'SYSTEM');
    this.opNames = { auto: list.filter(o => o.flavor === 'AUTONOMOUS').map(o => o.name), teleop: list.filter(o => o.flavor === 'TELEOP').map(o => o.name) };
    this.emit('oplist', this.opNames);
  }
  opModes() { return this.opNames; }
  init(name) { this.opName = name; this._cmd('CMD_INIT_OP_MODE', name); }
  start() { this._cmd('CMD_RUN_OP_MODE', this.opName || ''); }
  stop() { this._cmd('CMD_INIT_OP_MODE', '$Stop$Robot$'); }
  gamepad(user, g) { this.gp[user] = g; }
}

module.exports = { Robocol: DemoTransport, RealTransport };
