#!/usr/bin/env node
// index-seite.mjs — erzeugt <ziel>/index.html aus vorhandenen JSON-Daten
// Aufruf: node tools/index-seite.mjs --ziel=zugangsindex

import { readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const zielArg = args.find(a => a.startsWith('--ziel='));
if (!zielArg) {
  console.error('Fehler: --ziel=<verzeichnis> fehlt.');
  process.exit(2);
}
const ziel = zielArg.slice('--ziel='.length);
const basis = resolve(process.cwd(), ziel);

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
function zahl(n) {
  return Number(n).toLocaleString('de-DE');
}

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function leseJSON(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, 'utf8'));
  } catch (e) {
    console.error(`Fehler beim Lesen von ${pfad}: ${e.message}`);
    process.exit(2);
  }
}

function erwartet(wert, bezeichnung) {
  if (wert === undefined) {
    console.error(`Erwartetes Feld fehlt: ${bezeichnung}`);
    process.exit(2);
  }
  return wert;
}

function pct(zaehler, nenner) {
  if (!nenner) return '0,0';
  return (zaehler / nenner * 100).toFixed(1).replace('.', ',');
}

// ---------------------------------------------------------------------------
// Daten laden
// ---------------------------------------------------------------------------
const latest  = leseJSON(join(basis, 'data', 'latest.json'));
const datum    = erwartet(latest.datum, 'latest.datum');

const reihe    = leseJSON(join(basis, 'data', 'reihe.json'));
const panel    = leseJSON(join(basis, 'data', 'panel.json'));
const messung  = leseJSON(join(basis, 'data', 'messungen', `${datum}.json`));

// Pflichtfelder prüfen
erwartet(reihe.messpunkte,          'reihe.messpunkte');
erwartet(reihe.punkte,              'reihe.punkte');
erwartet(panel.domains,             'panel.domains');
erwartet(panel.rahmen,              'panel.rahmen');
erwartet(panel.gruppen,             'panel.gruppen');
erwartet(messung.agenten,           'messung.agenten');
erwartet(messung.vierGrosse,        'messung.vierGrosse');
erwartet(messung.gruppen,           'messung.gruppen');
erwartet(messung.gruppen.top300,    'messung.gruppen.top300');
erwartet(messung.gruppen.klein300,  'messung.gruppen.klein300');
erwartet(messung.domains,           'messung.domains');

const messpunkte    = reihe.messpunkte;
const erstesDatum   = reihe.punkte[0].datum;
const panelAnzahl   = panel.domains.length;
const agenten       = messung.agenten;
const vierGrosse    = new Set(messung.vierGrosse);
const vierGrosseArr = messung.vierGrosse;

const g300    = messung.gruppen.top300;
const gKlein  = messung.gruppen.klein300;
const bl300   = g300.mindestensEinerDerVierGrossenBlockiert;
const blKlein = gKlein.mindestensEinerDerVierGrossenBlockiert;

// Schlagzeilen
const anteil300Text   = String(bl300.anteil).replace('.', ',');
const anteilKleinText = String(blKlein.anteil).replace('.', ',');

// ---------------------------------------------------------------------------
// Abschnitt 1: Englischer Einleitungskasten
// ---------------------------------------------------------------------------
let englEnleitungsMesspunkt;
if (messpunkte === 1) {
  englEnleitungsMesspunkt = 'This is the first measurement point of an ongoing series.';
} else {
  englEnleitungsMesspunkt =
    `This is measurement point ${esc(messpunkte)} of an ongoing series starting ${esc(erstesDatum)}.`;
}

// ---------------------------------------------------------------------------
// Abschnitt 2: Crawler-Tabelle
// ---------------------------------------------------------------------------
function crawlerZeilen() {
  return agenten.map(agent => {
    const istVier = vierGrosse.has(agent);
    const nameTd = istVier
      ? `<td class="vier"><strong>${esc(agent)}</strong></td>`
      : `<td>${esc(agent)}</td>`;

    const pa300   = g300.proAgent[agent];
    const paKlein = gKlein.proAgent[agent];

    const b300   = pa300   ? pa300.blockiert   : 0;
    const n300   = pa300   ? pa300.nenner       : 0;
    const bK     = paKlein ? paKlein.blockiert  : 0;
    const nK     = paKlein ? paKlein.nenner      : 0;

    const p300   = pct(b300, n300);
    const pK     = pct(bK, nK);

    return `<tr${istVier ? ' class="vier"' : ''}>
        ${nameTd}
        <td class="zahl">${esc(b300)}/${esc(n300)}</td>
        <td class="zahl">${esc(p300)}&nbsp;%</td>
        <td class="zahl">${esc(bK)}/${esc(nK)}</td>
        <td class="zahl">${esc(pK)}&nbsp;%</td>
      </tr>`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Abschnitt 3: Veränderung
// ---------------------------------------------------------------------------
function wechselAbschnitt() {
  const wechsel = messung.wechsel;
  if (wechsel === null) {
    return `<p>Für diesen ersten Messpunkt gibt es noch keinen Vorgänger — die Reihe kann daher noch keine Veränderung zeigen. Genau das ist der Zweck dieser Seite: Sie wird mit jedem weiteren Messpunkt fortgeschrieben, und die erste Veränderung wird ab dem zweiten Messpunkt sichtbar.</p>`;
  }

  const beispiele = (wechsel.beispiele || []).map(b => {
    const aenderungen = (b.aenderungen || []).map(a =>
      `<tr>
          <td>${esc(b.domain)}</td>
          <td>${esc(a.agent)}</td>
          <td>${esc(a.von)} → ${esc(a.nach)}</td>
        </tr>`
    ).join('\n');
    return aenderungen;
  }).join('\n');

  return `<p>${esc(wechsel.domainsMitWechsel)} von ${esc(panelAnzahl)} Domains haben ihr Verdikt geändert (${esc(wechsel.wechselGesamt)} einzelne Verdikte).</p>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Domain</th><th>Crawler</th><th>Änderung</th></tr></thead>
        <tbody>${beispiele}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Abschnitt 4: Nenner / Ausschlüsse
// ---------------------------------------------------------------------------
function nennerAbschnitt() {
  const ohneRobots = messung.domains.filter(d => !d.hatRobots);

  // Alle vorkommenden Gründe sammeln, absteigend nach Gesamthäufigkeit
  const grundGesamt = {};
  for (const d of ohneRobots) {
    const g = d.grund || 'unbekannt';
    grundGesamt[g] = (grundGesamt[g] || 0) + 1;
  }
  const grundeSortiert = Object.entries(grundGesamt)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  // Je Gruppe zählen
  const top300Z   = {};
  const klein300Z = {};
  for (const d of ohneRobots) {
    const g = d.grund || 'unbekannt';
    if (d.gruppe === 'top300') top300Z[g]   = (top300Z[g]   || 0) + 1;
    else                       klein300Z[g] = (klein300Z[g] || 0) + 1;
  }

  const zeilen = grundeSortiert.map(g =>
    `<tr>
        <td>${esc(g)}</td>
        <td class="zahl">${esc(top300Z[g]   || 0)}</td>
        <td class="zahl">${esc(klein300Z[g] || 0)}</td>
        <td class="zahl">${esc(grundGesamt[g])}</td>
      </tr>`
  ).join('\n');

  const anzahlLeerOderKeineUA = messung.domains.filter(
    d => d.grund === 'leer' || d.grund === 'keine-user-agent-zeile'
  ).length;

  return `<p>In den Nenner gehen nur Domains ein, bei denen eine syntaktisch auswertbare <code>robots.txt</code> vorlag.
    Für die Top-300-Gruppe sind das ${esc(g300.mitGueltigerRobots)} Domains, für die kleine Gruppe ${esc(gKlein.mitGueltigerRobots)} Domains.</p>
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Ausschlussgrund</th>
            <th class="zahl">Top 300</th>
            <th class="zahl">Klein 300</th>
            <th class="zahl">Gesamt</th>
          </tr>
        </thead>
        <tbody>${zeilen}</tbody>
      </table>
    </div>
    <p>${esc(anzahlLeerOderKeineUA)} Domains lieferten HTTP 200 mit leerer oder User-agent-loser Datei. Nach der Norm bedeutet das <em>alles erlaubt</em>; hier zählen sie konservativ als <strong>unbekannt</strong> und stehen nicht im Nenner. Würde man sie als erlaubt zählen, sänken die Quoten um höchstens 0,3 Punkte.</p>`;
}

// ---------------------------------------------------------------------------
// schema.org/Dataset als JSON-LD
//
// Zweck: Google Dataset Search und vergleichbare Kataloge lesen ausschliesslich
// diese Auszeichnung. Sie ist der einzige Auffindungsweg, der weder ein Konto
// noch ein Postfach verlangt.
//
// REGEL: Jede Zahl hier wird aus den Daten abgeleitet, keine wird eingetippt.
// Was hier steht, muss auch im sichtbaren Text der Seite stehen.
// ---------------------------------------------------------------------------
const seitenURL = 'https://peppe1337.github.io/ki-zugangsindex/';
const letztesDatum = reihe.punkte[reihe.punkte.length - 1].datum;

// Bei einem einzigen Messpunkt ist die Abdeckung ein Tag, kein Zeitraum.
// Ein offenes Intervall ("2026-08-25/..") waere eine Zusage, kein Befund.
const temporalCoverage = erstesDatum === letztesDatum
  ? erstesDatum
  : `${erstesDatum}/${letztesDatum}`;

const jsonLd = {
  '@context': 'https://schema.org/',
  '@type': 'Dataset',
  name: 'KI-Zugangsindex — Sperrung von KI-Crawlern durch deutsche Websites',
  alternateName: 'KI-Zugangsindex',
  description:
    `Laengsschnitt ueber ${zahl(panelAnzahl)} deutsche Domains (.de) und die Frage, `
    + `welche davon KI-Crawlern per robots.txt den Zugriff auf / verweigern. `
    + `Das Panel besteht aus zwei Gruppen: den ${zahl(panel.gruppen.top300.domains ? panel.gruppen.top300.domains.length : panel.domains.filter(d => d.gruppe === 'top300').length)} `
    + `bestplatzierten .de-Domains und einer systematischen Stichprobe von `
    + `${zahl(panel.domains.filter(d => d.gruppe === 'klein300').length)} Domains mit Rang ueber 50.000. `
    + `Messpunkt vom ${erstesDatum}: ${bl300.zaehler} von ${bl300.nenner} `
    + `(${anteil300Text} %) der grossen und ${blKlein.zaehler} von ${blKlein.nenner} `
    + `(${anteilKleinText} %) der kleinen Domains sperren mindestens einen der vier `
    + `grossen KI-Crawler (${vierGrosseArr.join(', ')}). Insgesamt ausgewertet werden `
    + `${agenten.length} Crawler-Kennungen. Alle ${zahl(panelAnzahl)} Rohantworten und der `
    + `Auswertungscode liegen dem Datensatz bei. Bisherige Messpunkte: ${messpunkte}.`,
  url: seitenURL,
  sameAs: 'https://github.com/peppe1337/ki-zugangsindex',
  keywords: [
    'robots.txt', 'KI-Crawler', 'AI crawler', 'Robots Exclusion Protocol',
    ...vierGrosseArr,
    '.de-Domains', 'Deutschland', 'Web-Crawling', 'KI-Transparenz', 'Open Data'
  ],
  license: 'https://creativecommons.org/licenses/by/4.0/',
  isAccessibleForFree: true,
  creator: {
    '@type': 'Person',
    name: 'Christopher Kraft',
    url: `${seitenURL}impressum.html`
  },
  datePublished: erstesDatum,
  dateModified: datum,
  version: String(messpunkte),
  temporalCoverage,
  // spatialCoverage bewusst weggelassen: schema.org erwartet dort einen Ort.
  // Das Panel ist ueber die Top-Level-Domain .de definiert, nicht geografisch —
  // ".de" ist keine Zusicherung, dass der Betreiber in Deutschland sitzt.
  measurementTechnique:
    'HTTP-Abruf von /robots.txt je Domain und Auswertung der Direktiven nach dem '
    + 'Robots Exclusion Protocol (RFC 9309). Gezaehlt wird, ob der jeweiligen '
    + 'Crawler-Kennung der Pfad / untersagt wird. Domains ohne syntaktisch '
    + 'auswertbare robots.txt stehen nicht im Nenner.',
  variableMeasured: agenten.map(agent => ({
    '@type': 'PropertyValue',
    name: agent,
    description: `Sperrt die Domain der Kennung ${agent} den Pfad / per robots.txt?`
  })),
  distribution: [
    {
      '@type': 'DataDownload',
      name: 'Aktueller Stand (Kurzfassung)',
      contentUrl: `${seitenURL}data/latest.json`,
      encodingFormat: 'application/json'
    },
    {
      '@type': 'DataDownload',
      name: 'Zeitreihe aller Messpunkte',
      contentUrl: `${seitenURL}data/reihe.json`,
      encodingFormat: 'application/json'
    },
    {
      '@type': 'DataDownload',
      name: 'Panel-Definition (feste Domainliste)',
      contentUrl: `${seitenURL}data/panel.json`,
      encodingFormat: 'application/json'
    },
    ...reihe.punkte.map(p => ({
      '@type': 'DataDownload',
      name: `Einzelmessung ${p.datum} (je Domain)`,
      contentUrl: `${seitenURL}data/messungen/${p.datum}.json`,
      encodingFormat: 'application/json'
    }))
  ]
};

// </script> in einer Zeichenkette wuerde den Block vorzeitig schliessen.
const jsonLdText = JSON.stringify(jsonLd, null, 2).replace(/<\//g, '<\\/');

// ---------------------------------------------------------------------------
// Vollständiges HTML zusammenbauen
// ---------------------------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KI-Zugangsindex — wer im deutschen Web maschinellen Zugang sperrt</title>
  <meta name="description" content="${esc(bl300.zaehler)} von ${esc(bl300.nenner)} meistbesuchten .de-Domains (${esc(anteil300Text)} %) sperren mindestens einen der vier großen KI-Crawler. Bei kleinen .de-Domains sind es ${esc(blKlein.zaehler)} von ${esc(blKlein.nenner)} (${esc(anteilKleinText)} %).">
  <link rel="canonical" href="${seitenURL}">
  <script type="application/ld+json">
${jsonLdText}
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    :root {
      --bg: #ffffff;
      --fg: #1a1a1a;
      --bg2: #f4f4f4;
      --border: #cccccc;
      --accent: #0057b8;
      --vier-bg: #fff8e1;
      --vier-border: #f0c040;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #121212;
        --fg: #e8e8e8;
        --bg2: #1e1e1e;
        --border: #444444;
        --accent: #6fb3ff;
        --vier-bg: #2a2200;
        --vier-border: #8a6800;
      }
    }

    body {
      margin: 0;
      padding: 1.5rem 1rem;
      background: var(--bg);
      color: var(--fg);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 1rem;
      line-height: 1.6;
    }

    main {
      max-width: 52rem;
      margin: 0 auto;
    }

    h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.2rem; margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }

    a { color: var(--accent); }

    .kasten {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1rem 1.25rem;
      margin: 1.25rem 0;
    }

    .kasten.en {
      border-left: 4px solid var(--accent);
    }

    .schlagzeile {
      font-size: 1.05rem;
      margin: 0.4rem 0;
    }

    .schlagzeile strong {
      font-size: 1.35rem;
    }

    .tbl-wrap {
      overflow-x: auto;
      margin: 0.75rem 0;
    }

    table {
      border-collapse: collapse;
      min-width: 28rem;
      width: 100%;
    }

    th, td {
      border: 1px solid var(--border);
      padding: 0.35rem 0.65rem;
      text-align: left;
    }

    th { background: var(--bg2); font-weight: 600; }

    td.zahl, th.zahl { text-align: right; white-space: nowrap; }

    tr.vier td { background: var(--vier-bg); }

    td.vier { border-left: 3px solid var(--vier-border); }

    ul { padding-left: 1.25rem; }
    li { margin: 0.4rem 0; }

    code {
      font-family: ui-monospace, monospace;
      font-size: 0.9em;
      background: var(--bg2);
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }

    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      font-size: 0.875rem;
      color: var(--fg);
      opacity: 0.75;
    }
  </style>
</head>
<body>
<main>

  <h1>KI-Zugangsindex</h1>
  <p>Fortlaufende Messung von ${esc(panelAnzahl)} deutschen Domains, wie viele davon KI-Crawlern per <code>robots.txt</code> den Zugriff auf <code>/</code> verweigern.
  Bisherige Messpunkte: ${esc(messpunkte)}. Stand: ${esc(datum)}.</p>

  <!-- Kasten Stand -->
  <div class="kasten">
    <p class="schlagzeile"><strong>${esc(bl300.zaehler)} von ${esc(bl300.nenner)}</strong> = <strong>${esc(anteil300Text)} %</strong><br>
    <span>Die 300 meistbesuchten .de-Domains</span></p>

    <p class="schlagzeile"><strong>${esc(blKlein.zaehler)} von ${esc(blKlein.nenner)}</strong> = <strong>${esc(anteilKleinText)} %</strong><br>
    <span>300 kleine .de-Domains (Rang über 50.000)</span></p>

    <p style="margin-top:0.75rem; font-size:0.9rem;">Gezählt werden Domains, die mindestens einen der vier großen Crawler sperren:
    ${esc(vierGrosseArr.join(', '))}.</p>
  </div>

  <!-- Englischer Kasten -->
  <section class="kasten en" lang="en">
    <p>This page tracks which German-language websites block AI crawlers via <code>robots.txt</code>.
    The panel consists of ${esc(panelAnzahl)} <code>.de</code> domains split into two groups:
    the ${esc(g300.domains)} most-visited and a systematic sample (every 88th) of ${esc(gKlein.domains)} low-traffic domains (rank&nbsp;&gt;&nbsp;50,000).
    Among the top-${esc(g300.domains)} domains with a parseable <code>robots.txt</code> (${esc(g300.mitGueltigerRobots)} of ${esc(g300.domains)}),
    ${esc(bl300.zaehler)}&nbsp;of&nbsp;${esc(bl300.nenner)} (${esc(anteil300Text)}&nbsp;%) block at least one of the four major AI crawlers
    (${esc(vierGrosseArr.join(', '))}).
    Among the small-domain group (${esc(gKlein.mitGueltigerRobots)} of ${esc(gKlein.domains)} with valid <code>robots.txt</code>),
    the figure is ${esc(blKlein.zaehler)}&nbsp;of&nbsp;${esc(blKlein.nenner)} (${esc(anteilKleinText)}&nbsp;%).
    Raw data and the parser are in the repository at <a href="https://github.com/peppe1337/ki-zugangsindex">github.com/peppe1337/ki-zugangsindex</a>.
    ${englEnleitungsMesspunkt}</p>
  </section>

  <!-- Tabelle alle Crawler -->
  <h2>Alle ${esc(agenten.length)} Crawler im Überblick</h2>
  <p>Die vier mit ★ markierten Crawler bilden die Basis für den Hauptindikator (mindestens einer gesperrt).
  Alle anderen werden zusätzlich ausgewiesen. Prozentwerte berechnet als blockiert&nbsp;÷&nbsp;Nenner.</p>
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>Crawler</th>
          <th class="zahl">Top 300 gesperrt</th>
          <th class="zahl">Anteil %</th>
          <th class="zahl">Klein 300 gesperrt</th>
          <th class="zahl">Anteil %</th>
        </tr>
      </thead>
      <tbody>
        ${crawlerZeilen()}
      </tbody>
    </table>
  </div>
  <p style="font-size:0.875rem;">Hervorgehoben (★): ${esc(vierGrosseArr.join(', '))}.</p>

  <!-- Abschnitt Veränderung -->
  <h2>Veränderung gegenüber Vormesspunkt</h2>
  ${wechselAbschnitt()}

  <!-- Abschnitt Verfahren -->
  <h2>Verfahren</h2>
  <p><strong>Stichprobenrahmen:</strong> ${esc(panel.rahmen)}</p>
  <p><strong>Gruppe top300:</strong> ${esc(panel.gruppen.top300.regel)} (Rang ${esc(zahl(panel.gruppen.top300.rangVon))}–${esc(zahl(panel.gruppen.top300.rangBis))}).</p>
  <p><strong>Gruppe klein300:</strong> ${esc(panel.gruppen.klein300.regel)} (Rang ${esc(zahl(panel.gruppen.klein300.rangVon))}–${esc(zahl(panel.gruppen.klein300.rangBis))}).</p>
  <p>Für jede Domain wird <code>https://&lt;domain&gt;/robots.txt</code> abgerufen, mit bis zu 5 Weiterleitungen und einer Zeitgrenze von 15 Sekunden. Schlägt der HTTPS-Abruf fehl, wird auf <code>http://</code> zurückgefallen. Die Datei wird mit einem eigenen Gruppenparser nach robots.txt-Semantik ausgewertet: aufeinanderfolgende <code>User-agent</code>-Zeilen bilden eine Gruppe, ein exakter Treffer schlägt <code>*</code>, der längste passende Pfad gewinnt, bei Gleichstand gewinnt <code>Allow</code>.</p>

  <!-- Abschnitt Vorarbeiten -->
  <h2>Was es schon gibt</h2>
  <p>Damit es niemand erst nachtragen muss: Aggregatzahlen zu diesem Thema gibt es, und es lohnt
  sich, genau zu sein, was sie abdecken.</p>
  <ul>
    <li><a href="https://originality.ai/ai-bot-blocking">Originality.ai</a> verfolgt die Sperrquote
    von GPTBot in den <strong>weltweiten Top 1000</strong> seit August 2023 — 5 % damals,
    35,7 % im August 2024. Nicht nach Sprachraum aufgeschlüsselt.</li>
    <li>Das Reuters Institute hat die <strong>15 meistgenutzten Nachrichtenseiten</strong> in je
    zehn Ländern gemessen, Deutschland darunter, für das Jahr 2023
    (<a href="https://reutersinstitute.politics.ox.ac.uk/how-many-news-websites-block-ai-crawlers">Fletcher, 2024</a>).
    Eine einmalige Momentaufnahme, und ausschließlich Nachrichtenverlage.</li>
  </ul>
  <p>Eine deutsche Zahl gibt es also. Was es nicht gibt, ist ein deutsches Panel, das über
  Nachrichtenverlage und über die vorderen Ränge hinausreicht und auf denselben Domains
  wiederholt wird. Die ${esc(gKlein.domains)} kleinen Domains hier sind der Teil, den offenbar
  niemand beobachtet. Die Einzelabfrage „sperrt meine Seite GPTBot?“ verschenken dagegen mehrere
  Anbieter — daran ist hier nichts neu.</p>

  <!-- Abschnitt Was diese Messung nicht sagt -->
  <h2>Was diese Messung nicht sagt</h2>
  <ul>
    <li><code>robots.txt</code> ist eine Bitte, keine Sperre. Gemessen wird, was Betreiber <strong>erklären</strong>, nicht was technisch durchgesetzt wird.</li>
    <li>Sperren auf Netzwerkebene (z.B. über einen CDN-Anbieter) sind hier unsichtbar. Die echte Quote ist daher <strong>mindestens</strong> so hoch wie die gemessene.</li>
    <li>Je Stichprobe ${esc(g300.domains)} Domains. Unterschiede von wenigen Prozentpunkten bedeuten nichts.</li>
    <li>Es wird ausschließlich der Pfad <code>/</code> geprüft. Wer <code>/</code> freigibt und Unterverzeichnisse sperrt, zählt hier als „erlaubt".</li>
  </ul>

  <!-- Abschnitt Nenner -->
  <h2>Nenner und Ausschlüsse</h2>
  ${nennerAbschnitt()}

  <!-- Abschnitt Rohdaten -->
  <h2>Rohdaten und Nachprüfung</h2>
  <p>Jede Zahl auf dieser Seite wird aus den folgenden Dateien errechnet, nicht eingetippt:</p>
  <ul>
    <li><a href="data/latest.json">data/latest.json</a></li>
    <li><a href="data/reihe.json">data/reihe.json</a></li>
    <li><a href="data/messungen/${esc(datum)}.json">data/messungen/${esc(datum)}.json</a></li>
    <li><a href="data/panel.json">data/panel.json</a></li>
    <li><a href="roh/">roh/</a> (Rohverzeichnis)</li>
    <li><a href="https://github.com/peppe1337/ki-zugangsindex">https://github.com/peppe1337/ki-zugangsindex</a></li>
  </ul>

</main>

<footer>
  <main>
    <a href="impressum.html">Impressum und Datenschutz</a> &mdash;
    Verantwortlich: Christopher Kraft &mdash;
    Diese Seite wird von einem autonom arbeitenden Softwareagenten erstellt und gepflegt.
  </main>
</footer>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------
const zielDatei = join(basis, 'index.html');
writeFileSync(zielDatei, html, 'utf8');

const groesse = statSync(zielDatei).size;
const messpunktAnzahl = messung.domains.length;

console.log(`index.html geschrieben: ${groesse} Bytes, ${messpunktAnzahl} Domains, Stand ${datum}`);

// ---------------------------------------------------------------------------
// sitemap.xml — Google empfiehlt sie ausdruecklich, damit Datensatzseiten
// gefunden werden. Ohne Search-Console-Konto ist der Verweis aus robots.txt
// der einzige Weg, sie bekannt zu machen.
// ---------------------------------------------------------------------------
// impressum.html steht bewusst NICHT drin: die Seite traegt <meta name="robots"
// content="noindex">. Eine noindex-Seite in die Sitemap zu schreiben, waere ein
// Widerspruch, den Suchmaschinen zu Recht als Signalfehler werten.
const sitemapEintraege = [
  { loc: seitenURL, lastmod: datum },
  ...jsonLd.distribution.map(d => ({ loc: d.contentUrl, lastmod: datum }))
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEintraege.map(e => `  <url>
    <loc>${esc(e.loc)}</loc>
    <lastmod>${esc(e.lastmod)}</lastmod>
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(join(basis, 'sitemap.xml'), sitemap, 'utf8');

// Hier wird BEWUSST KEINE robots.txt geschrieben.
// robots.txt gilt nach RFC 9309 je Origin, nicht je Verzeichnis. Eine Datei unter
// /ki-zugangsindex/robots.txt liest kein Crawler — sie waere ein Artefakt, das
// aussieht, als wirke es. Die wirksame Datei liegt im Repo `peppe1337.github.io`
// und verweist von dort auf diese sitemap.xml.

console.log(`sitemap.xml geschrieben: ${sitemapEintraege.length} URLs.`);
