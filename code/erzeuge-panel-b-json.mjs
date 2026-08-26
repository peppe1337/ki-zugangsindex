#!/usr/bin/env node
// erzeuge-panel-b-json.mjs — erzeugt data/panel-b.json aus den Rohdaten in research/
// Aufruf: node code/erzeuge-panel-b-json.mjs
// Voraussetzung: research/lauf29-panelb/roh.json liegt relativ zum CWD als
//   ../research/lauf29-panelb/roh.json oder unter dem absoluten Pfad per --roh=<pfad>

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const rohArg  = args.find(a => a.startsWith('--roh='));
const zielArg = args.find(a => a.startsWith('--ziel='));

const rohPfad = rohArg
  ? resolve(rohArg.slice('--roh='.length))
  : resolve(process.cwd(), '../research/lauf29-panelb/roh.json');

const zielPfad = zielArg
  ? resolve(zielArg.slice('--ziel='.length))
  : resolve(process.cwd(), 'data/panel-b.json');

// ---------------------------------------------------------------------------
// Rohdaten laden
// ---------------------------------------------------------------------------
let roh;
try {
  roh = JSON.parse(readFileSync(rohPfad, 'utf8'));
} catch (e) {
  console.error(`Fehler beim Lesen von ${rohPfad}: ${e.message}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------
const VIER_GROSSE = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot'];
const vierGrosseSet = new Set(VIER_GROSSE);

// Alle Agenten aus erstem Eintrag
const agenten = roh.length > 0 ? Object.keys(roh[0].agenten) : [];

const auswertbar = roh.filter(d => d.hatRobots);
const gesperrt   = auswertbar.filter(d =>
  VIER_GROSSE.some(a => d.agenten[a] === 'blockiert')
);

// Je Agent: blockiert / nenner
const proAgent = {};
for (const agent of agenten) {
  const blockiert = auswertbar.filter(d => d.agenten[agent] === 'blockiert').length;
  proAgent[agent] = { blockiert, nenner: auswertbar.length };
}

// Anteil auf eine Dezimalstelle (als Zahl, nicht String — der Generator formatiert selbst)
const anteil = parseFloat((gesperrt.length / auswertbar.length * 100).toFixed(1));

// Messtag aus dem Zeitstempel der Messung ableiten. Er liegt nicht in roh.json,
// sondern in zusammenfassung.json daneben. Alle Einträge stammen vom selben Tag.
// KEIN Fallback auf ein eingetipptes Datum: ein still gesetzter Messtag wäre eine
// Angabe auf der öffentlichen Seite, die nicht aus den Daten stammt. Lieber laut
// scheitern als leise ein Datum erfinden.
let messtag;
try {
  const z = JSON.parse(readFileSync(
    resolve(rohPfad, '../zusammenfassung.json'), 'utf8'));
  messtag = z.zeitpunkt.slice(0, 10);
} catch (e) {
  throw new Error(
    `Messtag nicht ableitbar: zusammenfassung.json neben ${rohPfad} fehlt oder hat kein `
    + `Feld .zeitpunkt (${e.message}). Ein Fallback ist absichtlich nicht vorgesehen.`);
}

// ---------------------------------------------------------------------------
// Ausgabe zusammenstellen
// ---------------------------------------------------------------------------
const panelB = {
  messtag,
  panelGroesse:  roh.length,
  auswertbar:    auswertbar.length,
  vierGrosse:    VIER_GROSSE,
  gesperrt:      gesperrt.length,
  anteil,
  proAgent,
  ziehungsregel: 'jede 5. Zeile der 27.598 .de-Domains aus Tranco Top 1M, Ränge 204–999.938 (awk NR%5==1), deterministisch',
  rahmen:        'Tranco Top 1M, abgerufen 2026-08-25. Darin 27.598 .de-Domains mit Rang 204–999.938.',
  hinweis:       'Die 67 MB Rohantworten (5.520 vollständige robots.txt-Abrufe) liegen aus Größengründen NICHT im Repository. ' +
                 'Beiliegen: roh.json.gz (Verdikte je Domain, 171 KB) und panel-b.tsv (Domainliste). ' +
                 'Der Auswertungscode ist derselbe wie für Panel A (tools/kicrawler.mjs, unverändert).'
};

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------
writeFileSync(zielPfad, JSON.stringify(panelB, null, 2) + '\n', 'utf8');
console.log(`panel-b.json geschrieben: ${roh.length} Domains, ${auswertbar.length} auswertbar, ` +
            `${gesperrt.length} gesperrt (${anteil} %), Messtag ${messtag}`);
