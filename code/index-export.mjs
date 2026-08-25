// index-export.mjs
// Baut aus den Rohmessungen von tools/kicrawler.mjs die veroeffentlichten Datensaetze
// des KI-Zugangsindex.
//
// Erzeugt:
//   <ziel>/data/panel.json                    Das feste Panel (600 Domains, unveraenderlich)
//   <ziel>/data/messungen/<datum>.json        Ein Messpunkt: Verdikt je Domain und Agent
//   <ziel>/data/reihe.json                    Die Zeitreihe: Aggregate je Messpunkt + Wechsel
//   <ziel>/data/latest.json                   Zeiger auf den neuesten Messpunkt
//
// Aufruf:
//   node tools/index-export.mjs --gross=<verz> --klein=<verz> --datum=YYYY-MM-DD --ziel=<verz>
//
// Rot-Test eingebaut (--rottest): rechnet die Aggregate gegen eine unabhaengige zweite
// Zaehlung nach und bricht mit Exit 2 ab, wenn sie abweichen.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

const AGENTEN = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-User', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended',
  'CCBot', 'Bytespider', 'meta-externalagent', 'Amazonbot',
];

// Die vier, aus denen die Schlagzeilenzahl "mindestens einer gesperrt" gebildet wird.
// Auswahl vorab festgelegt: die vier Trainings-/Antwortcrawler der grossen Anbieter.
const VIER_GROSSE = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot'];

function args(argv) {
  const o = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-z]+)(?:=(.*))?$/);
    if (!m) { console.error(`Unbekanntes Argument: ${a}`); process.exit(3); }
    o[m[1]] = m[2] === undefined ? true : m[2];
  }
  return o;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregiere(eintraege) {
  const proAgent = {};
  for (const agent of AGENTEN) {
    let erlaubt = 0, blockiert = 0, unbekannt = 0;
    for (const e of eintraege) {
      const v = e.agenten[agent];
      if (v === 'erlaubt') erlaubt++;
      else if (v === 'blockiert') blockiert++;
      else unbekannt++;
    }
    proAgent[agent] = { erlaubt, blockiert, unbekannt, nenner: erlaubt + blockiert };
  }

  let mindEinerVierBlockiert = 0, mitRobots = 0;
  for (const e of eintraege) {
    if (!e.hatRobots) continue;
    mitRobots++;
    if (VIER_GROSSE.some(a => e.agenten[a] === 'blockiert')) mindEinerVierBlockiert++;
  }

  return {
    domains: eintraege.length,
    mitGueltigerRobots: mitRobots,
    mindestensEinerDerVierGrossenBlockiert: {
      zaehler: mindEinerVierBlockiert,
      nenner: mitRobots,
      anteil: mitRobots ? +(mindEinerVierBlockiert / mitRobots * 100).toFixed(1) : null,
    },
    proAgent,
  };
}

// Unabhaengige zweite Zaehlung fuer den Rot-Test: anderer Weg, gleiches Ergebnis.
function aggregiereZweitweg(eintraege) {
  const blockiertProAgent = Object.fromEntries(AGENTEN.map(a => [a, 0]));
  const nennerProAgent = Object.fromEntries(AGENTEN.map(a => [a, 0]));
  let vier = 0;
  eintraege.forEach(e => {
    AGENTEN.forEach(a => {
      const v = e.agenten[a];
      if (v !== 'unbekannt') nennerProAgent[a] += 1;
      if (v === 'blockiert') blockiertProAgent[a] += 1;
    });
    if (e.hatRobots) {
      const treffer = VIER_GROSSE.reduce((s, a) => s + (e.agenten[a] === 'blockiert' ? 1 : 0), 0);
      vier += treffer > 0 ? 1 : 0;
    }
  });
  return { blockiertProAgent, nennerProAgent, vier };
}

function rotTest(eintraege, agg) {
  const zweit = aggregiereZweitweg(eintraege);
  const fehler = [];
  for (const a of AGENTEN) {
    if (agg.proAgent[a].blockiert !== zweit.blockiertProAgent[a]) {
      fehler.push(`${a}: blockiert ${agg.proAgent[a].blockiert} vs ${zweit.blockiertProAgent[a]}`);
    }
    if (agg.proAgent[a].nenner !== zweit.nennerProAgent[a]) {
      fehler.push(`${a}: nenner ${agg.proAgent[a].nenner} vs ${zweit.nennerProAgent[a]}`);
    }
  }
  if (agg.mindestensEinerDerVierGrossenBlockiert.zaehler !== zweit.vier) {
    fehler.push(`vier-grosse: ${agg.mindestensEinerDerVierGrossenBlockiert.zaehler} vs ${zweit.vier}`);
  }
  return fehler;
}

// ── Wechsel zwischen zwei Messpunkten ─────────────────────────────────────────

function zaehleWechsel(vorher, jetzt) {
  if (!vorher) return null;
  const vorherMap = new Map(vorher.map(e => [e.domain, e]));
  let domainsMitWechsel = 0, wechselGesamt = 0;
  const beispiele = [];
  for (const e of jetzt) {
    const v = vorherMap.get(e.domain);
    if (!v) continue;
    const geaendert = AGENTEN.filter(a => v.agenten[a] !== e.agenten[a]);
    if (geaendert.length) {
      domainsMitWechsel++;
      wechselGesamt += geaendert.length;
      if (beispiele.length < 40) {
        beispiele.push({
          domain: e.domain,
          aenderungen: geaendert.map(a => ({ agent: a, von: v.agenten[a], nach: e.agenten[a] })),
        });
      }
    }
  }
  return { domainsMitWechsel, wechselGesamt, beispiele };
}

// ── Hauptlauf ─────────────────────────────────────────────────────────────────

const o = args(process.argv);
for (const pflicht of ['gross', 'klein', 'datum', 'ziel']) {
  if (!o[pflicht]) { console.error(`--${pflicht}=... fehlt`); process.exit(3); }
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(o.datum)) { console.error('--datum braucht YYYY-MM-DD'); process.exit(3); }

const rohGross = JSON.parse(readFileSync(resolve(o.gross, 'roh.json'), 'utf8'));
const rohKlein = JSON.parse(readFileSync(resolve(o.klein, 'roh.json'), 'utf8'));

const zielData = resolve(o.ziel, 'data');
const zielMess = resolve(zielData, 'messungen');
mkdirSync(zielMess, { recursive: true });

// Feld-Auswahl: nur was zur Nachpruefung noetig ist, keine Laufzeitartefakte.
function schlank(e, gruppe) {
  return {
    domain: e.domain,
    rang: e.rang,
    gruppe,
    hatRobots: e.hatRobots,
    grund: e.robotsGrund,
    httpStatus: e.httpStatus,
    agenten: e.agenten,
  };
}

const eintraege = [
  ...rohGross.map(e => schlank(e, 'top300')),
  ...rohKlein.map(e => schlank(e, 'klein300')),
];

// ── Panel: nur beim ersten Mal schreiben, danach nie wieder aendern ───────────
const panelPfad = resolve(zielData, 'panel.json');
if (!existsSync(panelPfad)) {
  writeFileSync(panelPfad, JSON.stringify({
    festgelegtAm: o.datum,
    hinweis: 'Dieses Panel wird nicht neu gezogen. Domains, die verschwinden, bleiben als unbekannt in der Reihe stehen, statt herauszufallen.',
    rahmen: 'Tranco Top 1M, abgerufen 2026-08-25. Darin 27.599 Domains mit Endung .de.',
    gruppen: {
      top300: { regel: 'die 300 bestplatzierten .de-Domains', rangVon: Math.min(...rohGross.map(e => e.rang)), rangBis: Math.max(...rohGross.map(e => e.rang)) },
      klein300: { regel: 'von allen 26.525 .de-Domains mit Rang > 50.000 jede 88., davon die ersten 300', rangVon: Math.min(...rohKlein.map(e => e.rang)), rangBis: Math.max(...rohKlein.map(e => e.rang)) },
    },
    domains: eintraege.map(e => ({ domain: e.domain, rang: e.rang, gruppe: e.gruppe })),
  }, null, 2) + '\n');
  console.log(`panel.json neu geschrieben (${eintraege.length} Domains)`);
} else {
  const panel = JSON.parse(readFileSync(panelPfad, 'utf8'));
  const imPanel = new Set(panel.domains.map(d => d.domain));
  const fehlend = eintraege.filter(e => !imPanel.has(e.domain));
  const zuviel = panel.domains.filter(d => !eintraege.some(e => e.domain === d.domain));
  if (fehlend.length || zuviel.length) {
    console.error(`=== PANELBRUCH === ${fehlend.length} neue, ${zuviel.length} fehlende Domains.`);
    console.error('Das Panel darf sich nicht aendern. Messung nicht uebernommen.');
    process.exit(2);
  }
  console.log(`panel.json unveraendert, Panel stimmt ueberein (${eintraege.length} Domains)`);
}

// ── Aggregate + Rot-Test ──────────────────────────────────────────────────────
const gruppen = {
  top300: aggregiere(eintraege.filter(e => e.gruppe === 'top300')),
  klein300: aggregiere(eintraege.filter(e => e.gruppe === 'klein300')),
  gesamt: aggregiere(eintraege),
};

if (o.rottest) {
  // Absichtlicher Bruch, um zu pruefen, dass der Rot-Test rot wird.
  gruppen.top300.proAgent.GPTBot.blockiert += 1;
}

let alleFehler = [];
for (const [name, agg] of Object.entries(gruppen)) {
  const teil = name === 'gesamt' ? eintraege : eintraege.filter(e => e.gruppe === name);
  alleFehler = alleFehler.concat(rotTest(teil, agg).map(f => `${name}: ${f}`));
}
if (alleFehler.length) {
  console.error('=== ROT-TEST FEHLGESCHLAGEN ===');
  alleFehler.forEach(f => console.error('  ' + f));
  process.exit(2);
}
console.log(`Rot-Test bestanden: ${Object.keys(gruppen).length} Gruppen x ${AGENTEN.length} Agenten unabhaengig nachgezaehlt.`);

// ── Messpunkt schreiben ───────────────────────────────────────────────────────
const vorhandene = readdirSync(zielMess).filter(f => f.endsWith('.json')).sort();
const vorigerName = vorhandene.filter(f => basename(f, '.json') < o.datum).pop();
const voriger = vorigerName ? JSON.parse(readFileSync(resolve(zielMess, vorigerName), 'utf8')) : null;
const wechsel = zaehleWechsel(voriger?.domains, eintraege);

const messpunkt = {
  datum: o.datum,
  agenten: AGENTEN,
  vierGrosse: VIER_GROSSE,
  gruppen,
  wechselGegenueber: vorigerName ? basename(vorigerName, '.json') : null,
  wechsel,
  domains: eintraege,
};
writeFileSync(resolve(zielMess, `${o.datum}.json`), JSON.stringify(messpunkt, null, 2) + '\n');

// ── Reihe fortschreiben ───────────────────────────────────────────────────────
const alleMesspunkte = readdirSync(zielMess).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(resolve(zielMess, f), 'utf8')));

const reihe = {
  aktualisiert: o.datum,
  messpunkte: alleMesspunkte.length,
  panelGroesse: eintraege.length,
  punkte: alleMesspunkte.map(m => ({
    datum: m.datum,
    top300: {
      nenner: m.gruppen.top300.mindestensEinerDerVierGrossenBlockiert.nenner,
      vierGrosseGesperrt: m.gruppen.top300.mindestensEinerDerVierGrossenBlockiert.zaehler,
      anteil: m.gruppen.top300.mindestensEinerDerVierGrossenBlockiert.anteil,
    },
    klein300: {
      nenner: m.gruppen.klein300.mindestensEinerDerVierGrossenBlockiert.nenner,
      vierGrosseGesperrt: m.gruppen.klein300.mindestensEinerDerVierGrossenBlockiert.zaehler,
      anteil: m.gruppen.klein300.mindestensEinerDerVierGrossenBlockiert.anteil,
    },
    proAgentBlockiert: Object.fromEntries(AGENTEN.map(a => [a, {
      top300: m.gruppen.top300.proAgent[a].blockiert,
      top300Nenner: m.gruppen.top300.proAgent[a].nenner,
      klein300: m.gruppen.klein300.proAgent[a].blockiert,
      klein300Nenner: m.gruppen.klein300.proAgent[a].nenner,
    }])),
    domainsMitWechsel: m.wechsel ? m.wechsel.domainsMitWechsel : null,
  })),
};
writeFileSync(resolve(zielData, 'reihe.json'), JSON.stringify(reihe, null, 2) + '\n');

writeFileSync(resolve(zielData, 'latest.json'), JSON.stringify({
  datum: o.datum,
  messpunkte: alleMesspunkte.length,
  panelGroesse: eintraege.length,
  quelle: `data/messungen/${o.datum}.json`,
  schlagzeile: {
    top300: gruppen.top300.mindestensEinerDerVierGrossenBlockiert,
    klein300: gruppen.klein300.mindestensEinerDerVierGrossenBlockiert,
  },
}, null, 2) + '\n');

// ── Bericht ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`Messpunkt ${o.datum}: ${eintraege.length} Domains, ${vorigerName ? `Wechsel gegen ${basename(vorigerName, '.json')}: ${wechsel.domainsMitWechsel} Domains / ${wechsel.wechselGesamt} Verdikte` : 'kein Vorgaenger, keine Wechsel berechenbar'}`);
for (const [name, agg] of Object.entries(gruppen)) {
  const s = agg.mindestensEinerDerVierGrossenBlockiert;
  console.log(`  ${name.padEnd(9)} mind. einer der vier grossen gesperrt: ${s.zaehler}/${s.nenner} = ${s.anteil} %`);
}
