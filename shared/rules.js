// Regel-Definitionen (Sonderregeln), gemeinsam genutzt von Server (Validierung) und Client (Lobby-UI).

export const RULE_DEFS = [
  { key: 'mitNeunen', group: 'Grundregeln', type: 'bool', def: true,
    label: 'Mit Neunen', help: '48 Karten (12 pro Spieler). Ohne Neunen: 40 Karten, 10 pro Spieler.' },
  { key: 'dullen', group: 'Grundregeln', type: 'select', def: 'zweite',
    label: 'Dullen (Herz-10)', help: 'Die Herz-Zehnen sind die höchsten Trümpfe. Welche sticht bei Gleichstand?',
    options: [
      ['zweite', 'Zweite sticht die erste'],
      ['zweite_ausser_letzter', 'Zweite sticht erste – außer im letzten Stich'],
      ['erste', 'Erste sticht die zweite'],
      ['aus', 'Ohne Dullen (Herz-10 ist Fehl)'],
    ] },
  { key: 'ansagen', group: 'Grundregeln', type: 'bool', def: true,
    label: 'Ansagen & Absagen', help: 'Re/Kontra, keine 90, keine 60, keine 30, schwarz.' },
  { key: 'spiele', group: 'Grundregeln', type: 'select', def: '0',
    label: 'Länge der Partie', help: 'Anzahl Spiele bis zur Endabrechnung.',
    options: [['0', 'Unbegrenzt'], ['4', '4 Spiele'], ['8', '8 Spiele'], ['12', '12 Spiele'], ['16', '16 Spiele'], ['20', '20 Spiele'], ['24', '24 Spiele']] },

  { key: 'hochzeit', group: 'Vorbehalte', type: 'bool', def: true,
    label: 'Hochzeit', help: 'Wer beide Kreuz-Damen hat, darf einen Partner suchen.' },
  { key: 'hochzeitKlaerung', group: 'Vorbehalte', type: 'select', def: 'erster', requires: 'hochzeit',
    label: 'Hochzeit: Klärungsstich', help: 'Welcher Fremdstich (in den ersten 3 Stichen) bestimmt den Partner?',
    options: [['erster', 'Erster Fremdstich'], ['fehl', 'Erster Fehl-Fremdstich'], ['trumpf', 'Erster Trumpf-Fremdstich']] },
  { key: 'armut', group: 'Vorbehalte', type: 'bool', def: true,
    label: 'Armut', help: 'Mit höchstens 3 Trümpfen darf man seine Trümpfe abgeben. Ein Mitspieler kann sie mitnehmen.' },
  { key: 'schmeissen', group: 'Vorbehalte', type: 'bool', def: true,
    label: 'Schmeißen', help: 'Mit 5 oder mehr Neunen oder Königen darf neu gegeben werden.' },

  { key: 'soloDamen', group: 'Soli', type: 'bool', def: true, label: 'Damensolo', help: 'Nur Damen sind Trumpf.' },
  { key: 'soloBuben', group: 'Soli', type: 'bool', def: true, label: 'Bubensolo', help: 'Nur Buben sind Trumpf.' },
  { key: 'soloFarben', group: 'Soli', type: 'bool', def: true, label: 'Farbsoli', help: 'Kreuz-, Pik-, Herz- oder Karosolo.' },
  { key: 'soloFleischlos', group: 'Soli', type: 'bool', def: true, label: 'Fleischloser', help: 'Asse-Solo ohne Trümpfe.' },
  { key: 'solistKommtRaus', group: 'Soli', type: 'bool', def: true,
    label: 'Solist kommt raus', help: 'Bei einem Solo spielt der Solist den ersten Stich an.' },

  { key: 'schweinchen', group: 'Trumpf-Extras', type: 'bool', def: false,
    label: 'Schweinchen', help: 'Wer beide Karo-Asse hat, dem werden sie zu den höchsten Trümpfen (über den Dullen).' },
  { key: 'superschweinchen', group: 'Trumpf-Extras', type: 'bool', def: false, requires: 'schweinchen',
    label: 'Superschweinchen', help: 'Beide Karo-Neunen (ohne Neunen: Karo-Könige) stechen sogar die Schweinchen.' },

  { key: 'fuchs', group: 'Sonderpunkte', type: 'bool', def: true,
    label: 'Fuchs gefangen', help: '+1 Punkt, wenn man ein Karo-Ass der Gegenpartei fängt.' },
  { key: 'karlchen', group: 'Sonderpunkte', type: 'bool', def: true,
    label: 'Karlchen', help: '+1 Punkt, wenn der Kreuz-Bube den letzten Stich macht.' },
  { key: 'doppelkopf', group: 'Sonderpunkte', type: 'bool', def: true,
    label: 'Doppelkopf', help: '+1 Punkt für einen Stich mit mindestens 40 Augen.' },
  { key: 'gegenDieAlten', group: 'Sonderpunkte', type: 'bool', def: true,
    label: 'Gegen die Alten', help: '+1 Punkt, wenn Kontra ein Normalspiel gewinnt.' },
  { key: 'bockrunden', group: 'Sonderpunkte', type: 'bool', def: false,
    label: 'Bockrunden', help: 'Nach 120:120 oder einem verlorenen Solo zählen die nächsten 4 Spiele doppelt.' },

  { key: 'botTempo', group: 'Tisch', type: 'select', def: 'normal',
    label: 'Bot-Tempo', help: 'Wie schnell die Bots spielen.',
    options: [['langsam', 'Gemütlich'], ['normal', 'Normal'], ['schnell', 'Schnell']] },
];

export const PRESETS = {
  kneipe: { label: 'Kneipenrunde', rules: {} },
  ddv: {
    label: 'DDV-Turnier',
    rules: { mitNeunen: true, dullen: 'zweite_ausser_letzter', armut: false, schmeissen: false,
      schweinchen: false, superschweinchen: false, soloFleischlos: true, bockrunden: false },
  },
  wild: {
    label: 'Alles an',
    rules: { schweinchen: true, superschweinchen: true, bockrunden: true, armut: true, schmeissen: true },
  },
  einfach: {
    label: 'Einsteiger',
    rules: { mitNeunen: false, hochzeit: true, armut: false, schmeissen: false, soloFarben: false,
      soloFleischlos: false, schweinchen: false, superschweinchen: false, fuchs: false, karlchen: false,
      doppelkopf: false, bockrunden: false },
  },
};

export function defaultRules() {
  const r = {};
  for (const d of RULE_DEFS) r[d.key] = d.def;
  return r;
}

export function applyPreset(name) {
  return sanitizeRules({ ...defaultRules(), ...(PRESETS[name]?.rules || {}) });
}

export function sanitizeRules(input) {
  const r = defaultRules();
  if (!input || typeof input !== 'object') return r;
  for (const d of RULE_DEFS) {
    const v = input[d.key];
    if (d.type === 'bool' && typeof v === 'boolean') r[d.key] = v;
    if (d.type === 'select' && d.options.some(([k]) => k === String(v))) r[d.key] = String(v);
  }
  for (const d of RULE_DEFS) if (d.requires && !r[d.requires] && d.type === 'bool') r[d.key] = false;
  return r;
}
