"use strict";
/**
 * Ersetzt lib/windowsConoutConnection.js aus node-pty 1.1.0 (MIT, Copyright Microsoft Corporation) ohne
 * Worker-Thread, weil Obsidians Renderer keine Worker starten kann (node-pty #821). Selbst geschrieben nach
 * node-pty, kein Code aus anderen Plugins. Schnittstelle wie das Original (Konstruktor (conoutPipeName,
 * useConptyDll), Getter onReady, connectSocket(socket), dispose()). Was dort lib/worker/conoutSocketWorker.js tut
 * (Pipe von ConPTY lesen, an einem zweiten Pipe-Namen bereitstellen), läuft hier im Hauptthread: Er muss die
 * Ausgabe selbst abholen, auch wenn ClosePseudoConsole beim Beenden darauf wartet.
 * copyNodePty (scripts/lib/native-copy.ts) setzt die Datei nur in die win32-Ziele ein.
 * Einbindung relativ zu lib/ (./eventEmitter2, ./shared/conout).
 */
const net = require("net");
const { getWorkerPipeName } = require("./shared/conout");
const { EventEmitter2 } = require("./eventEmitter2");

/** Wartezeit nach dem Beenden, bis die Sockets zugehen (wie im Original), damit Restausgabe noch ankommt. */
const FLUSH_DATA_INTERVAL = 1000;
/** Obergrenze der gemerkten Fehler (nur zur Diagnose, kein Teil des Originals). */
const MAX_ERRORS = 20;

class ConoutConnection {
  constructor(conoutPipeName, useConptyDll) {
    this._conoutPipeName = conoutPipeName;
    this._useConptyDll = useConptyDll;
    this._isDisposed = false;
    this._onReady = new EventEmitter2();
    this._server = undefined;
    this._drainTimeout = undefined;
    this._clients = new Set();
    /** Diagnose: Fehler der Sockets und des Servers, sie werfen nicht (sonst stürbe der Renderer-Hauptthread). */
    this.errors = [];

    const conout = new net.Socket();
    this._conout = conout;
    conout.setEncoding("utf8");
    conout.on("error", (e) => this._note("conout", e));
    conout.connect(conoutPipeName, () => {
      this._server = net.createServer((client) => {
        this._clients.add(client);
        client.on("close", () => this._clients.delete(client));
        client.on("error", (e) => this._note("client", e));
        conout.pipe(client);
      });
      this._server.on("error", (e) => this._note("server", e));
      this._server.listen(getWorkerPipeName(conoutPipeName), () => this._onReady.fire());
    });
  }

  get onReady() {
    return this._onReady.event;
  }

  dispose() {
    if (!this._useConptyDll && this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    // Daten erst noch auslaufen lassen, dann schließen
    this._drainDataAndClose();
  }

  connectSocket(socket) {
    socket.connect(getWorkerPipeName(this._conoutPipeName));
  }

  _drainDataAndClose() {
    if (this._drainTimeout) {
      clearTimeout(this._drainTimeout);
    }
    this._drainTimeout = setTimeout(() => this._destroySocket(), FLUSH_DATA_INTERVAL);
  }

  _destroySocket() {
    // Im Original beendet worker.terminate() alle Handles des Workers, auch die angenommenen Verbindungen;
    // erst dadurch geht der Socket des Hauptthreads zu und das Terminal meldet exit. Hier also ausdrücklich alles.
    try {
      this._conout.destroy();
    } catch (e) {
      this._note("destroy-conout", e);
    }
    for (const client of Array.from(this._clients)) {
      try {
        client.destroy();
      } catch (e) {
        this._note("destroy-client", e);
      }
    }
    try {
      if (this._server) {
        this._server.close();
      }
    } catch (e) {
      this._note("close-server", e);
    }
  }

  _note(where, e) {
    if (this.errors.length < MAX_ERRORS) {
      this.errors.push(where + ": " + String((e && (e.code || e.message)) || e));
    }
  }
}

exports.ConoutConnection = ConoutConnection;
