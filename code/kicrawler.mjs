// kicrawler.mjs
// Misst fuer eine Liste von Domains, ob bekannte KI-Crawler laut robots.txt
// den Pfad / abrufen duerfen.
//
// Ziehungsregel: die ERSTEN N Zeilen nach Rang (deterministisch, keine Zufallsauswahl).
//
// Aufruf:
//   node tools/kicrawler.mjs --n=300 [--datei=/tmp/de-domains.tsv] [--out=research/lauf25-kicrawler]
//
// Ausgabe:
//   <out>/roh/<domain>.txt     Rohantwort je Domain (max. 200 KB)
//   <out>/roh.json             Vollstaendige Ergebnisliste
//   <out>/zusammenfassung.json Je Agent: erlaubt / blockiert / unbekannt
//   stdout                     Tabelle + Rot-Test-Ergebnis

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, '..');

// ── Konstanten ────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; kraftmess-robots/1.0; +https://github.com/peppe1337)';
const MAX_GLEICHZEITIG = 6;
const PAUSE_MS = 200;          // Mindestpause pro Verbindung nach Abruf
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 200_000;     // 200 KB Limit je robots.txt
const MAX_UMLEITUNGEN = 5;

const AGENTEN = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
  'Amazonbot',
];

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let n = null;
  let datei = '/tmp/de-domains.tsv';
  let out = 'research/lauf25-kicrawler';
  for (const a of args) {
    const mN = a.match(/^--n=(\d+)$/);
    const mD = a.match(/^--datei=(.+)$/);
    const mO = a.match(/^--out=(.+)$/);
    if (mN) n = parseInt(mN[1], 10);
    else if (mD) datei = mD[1];
    else if (mO) out = mO[1];
  }
  if (!n || n < 1) {
    console.error('Fehler: --n=<Zahl> ist Pflicht und muss >= 1 sein.');
    process.exit(1);
  }
  return { n, datei, out };
}

// ── robots.txt-Parser ─────────────────────────────────────────────────────────
// Implementiert echten Gruppenparser gemaess Google/RFC-Konventionen.
// Gibt Map<agentLower, {allow: string[], disallow: string[]}> zurueck.

function parseRobots(text) {
  const gruppen = []; // [{agenten: Set<string>, allow: string[], disallow: string[]}]
  let aktuelleAgenten = null;
  let aktuelleAllow = [];
  let aktuelleDisallow = [];
  let hatRegel = false; // Mindestens eine Regel (Allow/Disallow) in dieser Gruppe gesehen

  function gruppeAbschliessen() {
    if (aktuelleAgenten && aktuelleAgenten.size > 0) {
      gruppen.push({
        agenten: aktuelleAgenten,
        allow: aktuelleAllow,
        disallow: aktuelleDisallow,
      });
    }
    aktuelleAgenten = null;
    aktuelleAllow = [];
    aktuelleDisallow = [];
    hatRegel = false;
  }

  const zeilen = text.split(/\r?\n/);
  for (let zeile of zeilen) {
    // Kommentare entfernen
    const kommentarIdx = zeile.indexOf('#');
    if (kommentarIdx !== -1) zeile = zeile.slice(0, kommentarIdx);
    zeile = zeile.trim();
    if (!zeile) continue;

    const doppelpunkt = zeile.indexOf(':');
    if (doppelpunkt === -1) continue;

    const feld = zeile.slice(0, doppelpunkt).trim().toLowerCase();
    const wert = zeile.slice(doppelpunkt + 1).trim();

    if (feld === 'user-agent') {
      if (hatRegel) {
        // Neue Gruppe beginnt — vorherige abschliessen
        gruppeAbschliessen();
      }
      if (!aktuelleAgenten) aktuelleAgenten = new Set();
      aktuelleAgenten.add(wert.toLowerCase());
    } else if (feld === 'allow') {
      if (aktuelleAgenten) {
        aktuelleAllow.push(wert);
        hatRegel = true;
      }
    } else if (feld === 'disallow') {
      if (aktuelleAgenten) {
        aktuelleDisallow.push(wert);
        hatRegel = true;
      }
    }
    // Sitemap und andere Felder ignorieren
  }
  gruppeAbschliessen();
  return gruppen;
}

// Prueft, ob ein Pfad-Muster auf einen konkreten Pfad passt.
// Unterstuetzt einfache Platzhalter: * (beliebige Zeichen) und $ (Ende).
// Fuer unsere Zwecke (Pfad immer "/") reicht einfaches Prefix-Matching + $ + *.
function musterPasst(muster, pfad) {
  if (!muster) return false;
  // Wildcard-Matching: * steht fuer beliebige Zeichenfolge, $ fuer Zeilenende
  // Umwandlung in Regex
  const regexStr = muster
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&') // Regex-Sonderzeichen escapen (nicht * und $)
    .replace(/\*/g, '.*');
  const endet = regexStr.endsWith('\\$') || muster.endsWith('$');
  const bereinigt = endet ? regexStr.slice(0, -2) : regexStr;
  const re = new RegExp('^' + bereinigt + (endet ? '$' : ''));
  return re.test(pfad);
}

// Bestimmt fuer einen Agenten, ob der Pfad "/" erlaubt ist.
// Rueckgabe: "erlaubt" | "blockiert" | "unbekannt"
function pruefePfad(gruppen, agent, pfad) {
  if (gruppen.length === 0) return 'erlaubt';

  const agentLower = agent.toLowerCase();

  // Exakten Treffer suchen
  let trefferGruppe = null;
  let sternGruppe = null;
  for (const g of gruppen) {
    if (g.agenten.has(agentLower)) {
      trefferGruppe = g;
      break;
    }
    if (g.agenten.has('*')) {
      sternGruppe = g;
    }
  }

  const gruppe = trefferGruppe ?? sternGruppe;
  if (!gruppe) return 'erlaubt'; // Kein Treffer, kein Wildcard → alles erlaubt

  // Regeln auswerten: laengstes passendes Muster gewinnt; Gleichstand → Allow
  let bestelaenge = -1;
  let ergebnis = 'erlaubt'; // Standardmaessig erlaubt wenn keine Regel greift

  for (const muster of gruppe.allow) {
    if (musterPasst(muster, pfad)) {
      const laenge = muster.length;
      if (laenge > bestelaenge || (laenge === bestelaenge && ergebnis === 'blockiert')) {
        bestelaenge = laenge;
        ergebnis = 'erlaubt';
      }
    }
  }

  for (const muster of gruppe.disallow) {
    if (!muster) continue; // Leeres Disallow = nichts verboten
    if (musterPasst(muster, pfad)) {
      const laenge = muster.length;
      if (laenge > bestelaenge) {
        bestelaenge = laenge;
        ergebnis = 'blockiert';
      }
      // Bei Gleichstand gewinnt Allow (bleibt ergebnis unberuehrt wenn schon "erlaubt")
    }
  }

  return ergebnis;
}

// Bestimmt alle Agenten-Ergebnisse aus einem robots.txt-Text.
function werteAus(robotsText, agenten) {
  const gruppen = parseRobots(robotsText);
  const ergebnisse = {};
  for (const agent of agenten) {
    ergebnisse[agent] = pruefePfad(gruppen, agent, '/');
  }
  return ergebnisse;
}

// ── Rot-Tests ─────────────────────────────────────────────────────────────────

function rotTests() {
  let bestanden = 0;
  let gesamt = 0;
  const fehler = [];

  // LEHRE AUS LAUF 26: Diese Funktion rief frueher parseRobots + pruefePfad direkt auf und
  // ging damit AN werteAus() vorbei -- also genau an der Funktion, die die Messung benutzt.
  // Ein Sabotagetest ("werteAus gibt immer erlaubt zurueck") blieb deshalb gruen. Die Tests
  // laufen jetzt durch denselben Einstiegspunkt wie die Messung.
  function test(nr, beschreibung, robotsText, erwartungen) {
    gesamt++;
    let ok = true;
    const ergebnisse = werteAus(robotsText, Object.keys(erwartungen));
    for (const [agent, erwartet] of Object.entries(erwartungen)) {
      const ist = ergebnisse[agent];
      if (ist !== erwartet) {
        ok = false;
        fehler.push(`Fall ${nr} (${beschreibung}): ${agent} soll "${erwartet}", ist aber "${ist}"`);
      }
    }
    if (ok) bestanden++;
    return ok;
  }

  // Fall 1: Leere Datei → alle Agenten erlaubt
  test(1, 'Leere Datei', '', Object.fromEntries(AGENTEN.map(a => [a, 'erlaubt'])));

  // Fall 2: Alle blockiert
  test(2, 'User-agent: *\\nDisallow: /', 'User-agent: *\nDisallow: /',
    Object.fromEntries(AGENTEN.map(a => [a, 'blockiert'])));

  // Fall 3: GPTBot spezifisch blockiert, * frei
  test(3, 'GPTBot blockiert, CCBot erlaubt via *',
    'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:',
    { GPTBot: 'blockiert', ClaudeBot: 'erlaubt' });

  // Fall 4: * blockiert, GPTBot spezifisch erlaubt
  test(4, 'GPTBot erlaubt via Allow, CCBot blockiert via *',
    'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /',
    { GPTBot: 'erlaubt', CCBot: 'blockiert' });

  // Fall 5: Gross-/Kleinschreibung
  test(5, 'gptbot klein geschrieben',
    'User-agent: gptbot\nDisallow: /',
    { GPTBot: 'blockiert' });

  // Fall 6: Gleiche Laenge, Allow gewinnt
  test(6, 'Disallow und Allow gleich lang, Allow gewinnt',
    'User-agent: *\nDisallow: /\nAllow: /',
    Object.fromEntries(AGENTEN.map(a => [a, 'erlaubt'])));

  // Fall 7: Disallow /private/ trifft Pfad / nicht
  test(7, 'Disallow /private/ betrifft / nicht',
    'User-agent: *\nDisallow: /private/',
    Object.fromEntries(AGENTEN.map(a => [a, 'erlaubt'])));

  // Fall 8: Zwei aufeinanderfolgende User-agent-Zeilen
  test(8, 'GPTBot und CCBot in gemeinsamer Gruppe blockiert',
    'User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /',
    { GPTBot: 'blockiert', CCBot: 'blockiert', ClaudeBot: 'erlaubt' });

  // Fall 9: HTML statt robots.txt → istEchteRobots muss hatRobots===false mit grund html-statt-robots liefern
  {
    gesamt++;
    const htmlText = '<!DOCTYPE html><html><body>Not Found</body></html>';
    const pruef = istEchteRobots(htmlText, 200);
    if (!pruef.ja && pruef.grund === 'html-statt-robots') {
      bestanden++;
    } else {
      fehler.push(`Fall 9 (HTML-Erkennung): erwartet ja=false/grund=html-statt-robots, bekommen ja=${pruef.ja}/grund=${pruef.grund}`);
    }
  }

  // Fall 10: Nagelt den geprueften Pfad auf "/" fest.
  // LEHRE AUS LAUF 26: Alle Faelle 1-9 blieben gruen, als werteAus() statt "/" den Pfad
  // "/irgendwas" pruefte. Die gesamte Veroeffentlichung behauptet aber eine Aussage ueber "/".
  // Dieser Fall unterscheidet die beiden: "/" ist erlaubt, "/irgendwas" waere blockiert.
  test(10, 'Geprueft wird der Pfad / und nicht ein Unterpfad',
    'User-agent: *\nDisallow: /irgendwas\n',
    Object.fromEntries(AGENTEN.map(a => [a, 'erlaubt'])));

  return { bestanden, gesamt, fehler };
}

// Netz-Rot-Test: nicht-existierende Domain muss hatRobots===false liefern
// und darf fuer keinen Agenten als "erlaubt" gewertet werden (alle muessen "unbekannt" sein).
async function netzRotTest() {
  const domain = `gibtesnicht-${process.pid}.de`;
  const abruf = await holRobots(domain);

  // Dieselbe Logik wie in messDomain: hatRobots und agenten bestimmen
  let hatRobotsWert;
  let agenten;
  if (!abruf.ok) {
    hatRobotsWert = false;
    agenten = Object.fromEntries(AGENTEN.map(a => [a, 'unbekannt']));
  } else {
    const pruef = istEchteRobots(abruf.text, abruf.status);
    hatRobotsWert = pruef.ja;
    if (pruef.ja) {
      agenten = werteAus(abruf.text, AGENTEN);
    } else {
      agenten = Object.fromEntries(AGENTEN.map(a => [a, 'unbekannt']));
    }
  }

  // Schritt 1: hatRobots muss false sein
  if (hatRobotsWert !== false) {
    return { ok: false, grund: `hatRobots ist true fuer nicht-existierende Domain ${domain}` };
  }

  // Schritt 2: kein Agent darf als "erlaubt" gewertet sein
  for (const agent of AGENTEN) {
    if (agenten[agent] === 'erlaubt') {
      return { ok: false, grund: `Agent ${agent} ist "erlaubt" fuer nicht-existierende Domain ${domain}` };
    }
  }

  return { ok: true, domain };
}

// ── Abruf ─────────────────────────────────────────────────────────────────────

async function holRobots(domain) {
  const urls = [`https://${domain}/robots.txt`, `http://${domain}/robots.txt`];
  let letzterFehler = null;
  let versuch = 0;

  for (const basisUrl of urls) {
    versuch++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let antwort;
      try {
        antwort = await fetch(basisUrl, {
          signal: ctrl.signal,
          redirect: 'follow',
          follow: MAX_UMLEITUNGEN,
          headers: { 'User-Agent': UA },
        });
      } finally {
        clearTimeout(timer);
      }

      const endUrl = antwort.url || basisUrl;
      const status = antwort.status;

      // Inhalt lesen, max 200 KB
      const puffer = await antwort.arrayBuffer();
      const bytes = puffer.byteLength;
      const begrenzt = bytes > MAX_BYTES ? puffer.slice(0, MAX_BYTES) : puffer;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(begrenzt);

      return {
        ok: true,
        status,
        endUrl,
        bytes,
        text,
        fehler: null,
        httpsVersuch: versuch === 1,
      };
    } catch (err) {
      letzterFehler = err.message || String(err);
      // Bei https-Fehler: http versuchen
      if (versuch === 1) continue;
    }
  }

  return {
    ok: false,
    status: null,
    endUrl: null,
    bytes: 0,
    text: null,
    fehler: letzterFehler,
    httpsVersuch: false,
  };
}

// Prueft ob Text eine echte robots.txt ist (nicht HTML-Fehlerseite etc.)
function istEchteRobots(text, status) {
  if (status !== 200) return { ja: false, grund: `http-status-${status}` };
  if (!text || text.trim().length === 0) return { ja: false, grund: 'leer' };

  const lower = text.toLowerCase().trimStart();
  // HTML-Erkennung
  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    return { ja: false, grund: 'html-statt-robots' };
  }
  // Muss mindestens eine user-agent:-Zeile enthalten
  if (!lower.includes('user-agent:')) {
    return { ja: false, grund: 'keine-user-agent-zeile' };
  }
  return { ja: true, grund: null };
}

// ── Hauptmessung ──────────────────────────────────────────────────────────────

async function messDomain(rang, domain, rohVerz) {
  const start = Date.now();
  const abruf = await holRobots(domain);

  // Rohdaten speichern
  const rohPfad = resolve(rohVerz, `${domain}.txt`);
  if (abruf.text !== null) {
    writeFileSync(rohPfad, abruf.text, 'utf8');
  } else {
    writeFileSync(rohPfad, `FEHLER: ${abruf.fehler}\n`, 'utf8');
  }

  if (!abruf.ok) {
    return {
      rang,
      domain,
      httpStatus: null,
      endgueltigeUrl: null,
      bytes: 0,
      hatRobots: false,
      robotsGrund: 'netz-fehler',
      fehler: abruf.fehler,
      agenten: Object.fromEntries(AGENTEN.map(a => [a, 'unbekannt'])),
      dauerMs: Date.now() - start,
    };
  }

  const pruef = istEchteRobots(abruf.text, abruf.status);

  let agenten;
  if (pruef.ja) {
    agenten = werteAus(abruf.text, AGENTEN);
  } else {
    agenten = Object.fromEntries(AGENTEN.map(a => [a, 'unbekannt']));
  }

  return {
    rang,
    domain,
    httpStatus: abruf.status,
    endgueltigeUrl: abruf.endUrl,
    bytes: abruf.bytes,
    hatRobots: pruef.ja,
    robotsGrund: pruef.grund,
    fehler: null,
    agenten,
    dauerMs: Date.now() - start,
  };
}

// Pool: maximal MAX_GLEICHZEITIG gleichzeitige Abrufe, mind. PAUSE_MS Pause je Slot
async function poolMessen(aufgaben, rohVerz) {
  const ergebnisse = new Array(aufgaben.length);
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= aufgaben.length) break;
      const { rang, domain } = aufgaben[i];
      const startZeit = Date.now();
      ergebnisse[i] = await messDomain(rang, domain, rohVerz);
      const vergangen = Date.now() - startZeit;
      const restPause = PAUSE_MS - vergangen;
      if (restPause > 0) await sleep(restPause);
      process.stderr.write(`\r${i + 1}/${aufgaben.length} ${domain}            `);
    }
  }

  const arbeiter = [];
  for (let i = 0; i < Math.min(MAX_GLEICHZEITIG, aufgaben.length); i++) {
    arbeiter.push(worker());
  }
  await Promise.all(arbeiter);
  process.stderr.write('\n');
  return ergebnisse;
}

// ── Tabelle ───────────────────────────────────────────────────────────────────

function druckeTabelle(ergebnisse) {
  const mitRobots = ergebnisse.filter(e => e.hatRobots);
  const nenner = mitRobots.length;

  // Zaehlen
  const zaehler = {};
  for (const agent of AGENTEN) {
    zaehler[agent] = { erlaubt: 0, blockiert: 0, unbekannt: 0 };
  }
  for (const e of ergebnisse) {
    for (const agent of AGENTEN) {
      const status = e.agenten[agent];
      if (status === 'erlaubt') zaehler[agent].erlaubt++;
      else if (status === 'blockiert') zaehler[agent].blockiert++;
      else zaehler[agent].unbekannt++;
    }
  }

  // Tabellenkopf
  const kopfAgent = 'Agent';
  const kopfBlock = 'blockiert';
  const kopfErl = 'erlaubt';
  const kopfAnteil = 'Anteil blockiert';

  const maxAgent = Math.max(kopfAgent.length, ...AGENTEN.map(a => a.length));
  const maxBlock = kopfBlock.length + 2;
  const maxErl = kopfErl.length + 2;
  const maxAnteil = kopfAnteil.length + 2;

  const trenn = `${'─'.repeat(maxAgent + 2)}┼${'─'.repeat(maxBlock + 2)}┼${'─'.repeat(maxErl + 2)}┼${'─'.repeat(maxAnteil + 2)}`;

  console.log('');
  console.log(`Auswertung (Nenner: ${nenner} Domains mit gueltiger robots.txt von ${ergebnisse.length} geprueft)`);
  console.log('');
  console.log(` ${'Agent'.padEnd(maxAgent)} │ ${'blockiert'.padStart(maxBlock)} │ ${'erlaubt'.padStart(maxErl)} │ ${'Anteil blockiert'.padEnd(maxAnteil)}`);
  console.log(trenn);

  const zusammenfassung = {};
  for (const agent of AGENTEN) {
    const { erlaubt, blockiert, unbekannt } = zaehler[agent];
    const anteil = nenner > 0 ? ((blockiert / nenner) * 100).toFixed(1) + '%' : '—';
    console.log(` ${agent.padEnd(maxAgent)} │ ${String(blockiert).padStart(maxBlock)} │ ${String(erlaubt).padStart(maxErl)} │ ${anteil}`);
    zusammenfassung[agent] = { erlaubt, blockiert, unbekannt, nenner };
  }

  console.log('');
  return zusammenfassung;
}

// ── Einstiegspunkt ────────────────────────────────────────────────────────────

async function main() {
  // --nurrottest: nur die Parser-Rot-Tests laufen lassen, ohne Netz und ohne Messung.
  // Damit ist der Parser nachpruefbar, ohne 300 fremde Server abzurufen.
  if (process.argv.slice(2).includes('--nurrottest')) {
    const { bestanden, gesamt, fehler } = rotTests();
    if (fehler.length > 0) {
      console.error('=== ROT-TEST FEHLGESCHLAGEN ===');
      for (const f of fehler) console.error('  FEHLER: ' + f);
      console.error(`Rot-Tests: ${bestanden}/${gesamt} bestanden (Exit 2).`);
      process.exit(2);
    }
    console.log(`Parser-Rot-Tests: ${bestanden}/${gesamt} bestanden.`);
    process.exit(0);
  }

  const { n, datei, out } = parseArgs(process.argv);

  // Ausgabeverzeichnisse anlegen
  const outVerz = resolve(WORKSPACE, out);
  const rohVerz = resolve(outVerz, 'roh');
  mkdirSync(rohVerz, { recursive: true });

  // ── Rot-Tests ──────────────────────────────────────────────────────────────
  console.log('=== Rot-Tests ===');
  const { bestanden, gesamt, fehler: rotFehler } = rotTests();

  // Netz-Rot-Test
  process.stdout.write('Netz-Rot-Test (nicht-existierende Domain)... ');
  const netzTest = await netzRotTest();
  if (netzTest.ok) {
    console.log('bestanden');
  } else {
    console.log('FEHLGESCHLAGEN');
    rotFehler.push(`Netz-Rot-Test: ${netzTest.grund}`);
  }

  const rotGesamt = gesamt + 1; // +1 fuer Netz-Rot-Test
  const rotBestanden = bestanden + (netzTest.ok ? 1 : 0);

  if (rotFehler.length > 0) {
    console.error('');
    console.error('=== ROT-TEST FEHLGESCHLAGEN ===');
    for (const f of rotFehler) console.error('  FEHLER: ' + f);
    console.error(`Rot-Tests: ${rotBestanden}/${rotGesamt} bestanden`);
    console.error('Messung abgebrochen (Exit 2).');
    process.exit(2);
  }

  console.log(`Rot-Tests: ${rotBestanden}/${rotGesamt} bestanden`);
  console.log('');

  // ── Domains laden ──────────────────────────────────────────────────────────
  if (!existsSync(datei)) {
    console.error(`Fehler: Datei nicht gefunden: ${datei}`);
    process.exit(1);
  }

  const zeilen = readFileSync(datei, 'utf8')
    .split('\n')
    .map(z => z.trim())
    .filter(z => z.length > 0);

  // Erste N Zeilen nach Rang (deterministisch)
  const auswahl = zeilen.slice(0, n);
  const aufgaben = auswahl.map(zeile => {
    const teile = zeile.split('\t');
    return { rang: parseInt(teile[0], 10) || 0, domain: teile[1] || zeile };
  }).filter(a => a.domain);

  console.log(`Messe ${aufgaben.length} Domains (erste ${n} Zeilen aus ${datei})`);
  console.log(`Ausgabe: ${outVerz}`);
  console.log(`Ziehungsregel: erste ${n} Zeilen nach Rang, deterministisch`);
  console.log('');

  // ── Abruf ──────────────────────────────────────────────────────────────────
  const ergebnisse = await poolMessen(aufgaben, rohVerz);

  // ── Dateien schreiben ──────────────────────────────────────────────────────
  const rohJsonPfad = resolve(outVerz, 'roh.json');
  writeFileSync(rohJsonPfad, JSON.stringify(ergebnisse, null, 2), 'utf8');

  // ── Tabelle & Zusammenfassung ──────────────────────────────────────────────
  const zusammenfassung = druckeTabelle(ergebnisse);

  const zusammenfassungPfad = resolve(outVerz, 'zusammenfassung.json');
  writeFileSync(zusammenfassungPfad, JSON.stringify({
    zeitpunkt: new Date().toISOString(),
    n: aufgaben.length,
    datei,
    ziehungsregel: `die ersten ${aufgaben.length} Zeilen der Eingabedatei ${datei}, unveraendert uebernommen`,
    agenten: zusammenfassung,
  }, null, 2), 'utf8');

  console.log(`Dateien:`);
  console.log(`  ${rohJsonPfad}`);
  console.log(`  ${zusammenfassungPfad}`);
  console.log(`  ${rohVerz}/<domain>.txt`);
  console.log('');
  console.log(`Rot-Tests: ${rotBestanden}/${rotGesamt} bestanden`);
}

main().catch(err => {
  console.error('Fataler Fehler:', err);
  process.exit(1);
});
