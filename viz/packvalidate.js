/* packvalidate.js: checks a model pack manifest (the parsed pack.yaml). No DOM, no dependencies, so the shell, the tests and the build can all use it.
 *
 *   const r = PackSpec.validate(manifest);        // { ok, errors: [..], warnings: [..] }
 *   PackSpec.checkValue(manifest.params.beta, 0.3) // null, or a message
 *
 * The rules are the same as paperdolls/pack.py (the two are tested against the same cases in tests/pack_cases.json) and are written up in
 * docs/pack-spec.md. Errors say where: "params.beta.default: 2 is above max 1".
 */
(function (root) {
  'use strict';
  const HEX = /^#[0-9a-fA-F]{6}$/, SLUG = /^[a-z][a-z0-9-]*$/, NAME = /^[a-z][a-z0-9_]*$/;
  const RUNTIMES = ['js', 'pyodide', 'remote'];
  const PARAM_TYPES = ['number', 'integer', 'boolean', 'enum'];
  const FIELD_TYPES = ['category', 'number', 'int', 'boolean'];
  const CHANNELS = ['wall', 'overlay', 'segments', 'outline', 'halo', 'groundtint'], PLANNED_CHANNELS = ['height', 'ground'];
  const AGGREGATES = ['mean', 'sum', 'min', 'max'];
  const COLOUR_ON = ['wall', 'roof', 'wall+roof'], LOD_FAR = ['aggregate', 'hide', 'show'];
  const OVERLAYS = ['scaffold', 'solar', 'band', 'marker', 'insulation', 'community'];
  const SEG_MAX = 12;
  const REGIONS = ['left', 'right', 'bottom'];
  const CONTROLS = ['params', 'presets', 'compare', 'timeline', 'legend', 'display'], PLANNED_ITEMS = ['table'], ITEM_KINDS = ['control', 'chart', 'kpis', 'table'];
  const CHART_TYPES = ['line', 'area', 'bar'], DISPLAY_IDS = ['people', 'vehicles', 'ink', 'pixel', 'fog'], KPI_AT = ['now', 'final', 'max', 'min'];
  const ITEM_KEYS = { control: ['control', 'groups', 'items'], chart: ['chart', 'series', 'y', 'title', 'unit', 'x', 'compare'], kpis: ['kpis', 'title'], table: ['table', 'series'] };
  const TOP = ['spec', 'id', 'title', 'description', 'runtime', 'time', 'params', 'presets', 'entities', 'mappings', 'series', 'layout', 'banner'];

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = v => typeof v === 'number' && isFinite(v);
  const isInt = v => isNum(v) && Math.floor(v) === v;
  const isStr = v => typeof v === 'string' && v.trim() !== '';
  const keysOf = o => (isObj(o) ? Object.keys(o) : []);

  // The values of an enum (strings, or {value, label}) as a list of strings.
  function enumValues(spec) { return (Array.isArray(spec.values) ? spec.values : []).map(v => (isObj(v) ? v.value : v)); }

  // null when v is a legal value of the parameter, else the reason.
  function checkValue(p, v) {
    if (p.type === 'boolean') return typeof v === 'boolean' ? null : 'must be true or false';
    if (p.type === 'enum') return enumValues(p).includes(v) ? null : 'must be one of ' + enumValues(p).join(', ');
    if (p.type === 'number' || p.type === 'integer') {
      if (!isNum(v)) return 'must be a number';
      if (p.type === 'integer' && !isInt(v)) return 'must be a whole number';
      if (isNum(p.min) && v < p.min) return v + ' is below min ' + p.min;
      if (isNum(p.max) && v > p.max) return v + ' is above max ' + p.max;
      return null;
    }
    return 'unknown parameter type';
  }

  function validate(m) {
    const errors = [], warnings = [];
    const err = (at, msg) => errors.push(at + ': ' + msg), warn = (at, msg) => warnings.push(at + ': ' + msg);
    if (!isObj(m)) return { ok: false, errors: ['manifest: must be a mapping'], warnings };
    for (const k of Object.keys(m)) if (!TOP.includes(k)) err(k, 'unknown top-level key (known: ' + TOP.join(', ') + ')');
    if (m.spec !== undefined && m.spec !== 1) err('spec', 'must be 1');
    if (!isStr(m.id) || !SLUG.test(m.id)) err('id', 'required: lower-case letters, digits and hyphens, starting with a letter');
    if (!isStr(m.title)) err('title', 'required: a non-empty string');
    if (m.description !== undefined && typeof m.description !== 'string') err('description', 'must be a string');

    // ---- runtime ----
    const rt = m.runtime;
    if (!isObj(rt)) err('runtime', 'required: {type: js, entry: runtime.js}');
    else {
      for (const k of Object.keys(rt)) if (!['type', 'entry', 'files', 'seed', 'on_params', 'options'].includes(k)) err('runtime.' + k, 'unknown key');
      if (!RUNTIMES.includes(rt.type)) err('runtime.type', 'must be one of ' + RUNTIMES.join(', '));
      else if (rt.type !== 'js') warn('runtime.type', rt.type + ' runtimes are planned; only js runs today');
      if (rt.type === 'js' && !isStr(rt.entry)) err('runtime.entry', 'required for a js runtime: the file that registers it');
      if (rt.files !== undefined) {
        if (!Array.isArray(rt.files) || !rt.files.length || !rt.files.every(isStr)) err('runtime.files', 'must be a non-empty list of file names, in the order they load (the entry among them)');
        else {
          const norm = f => { if (f.startsWith('/') || f.includes('\\') || /^[A-Za-z]:/.test(f)) return null; const parts = f.split('/').filter(x => x !== '' && x !== '.'); return !parts.length || parts.includes('..') ? null : parts.join('/'); };
          const seen = new Set();
          rt.files.forEach((f, i) => { const n = norm(f); if (n === null) err('runtime.files[' + i + ']', 'must be a relative path inside the pack folder (no leading / and no ..)'); else if (seen.has(n)) err('runtime.files[' + i + ']', f + ' is listed twice'); seen.add(n); });
          if (isStr(rt.entry) && !seen.has(norm(rt.entry))) err('runtime.files', 'must include the entry ' + rt.entry + ' (list every file that is inlined, in load order)');
        }
      }
      if (rt.seed !== undefined && !isInt(rt.seed)) err('runtime.seed', 'must be a whole number');
      if (rt.on_params !== undefined && !['rerun', 'continue'].includes(rt.on_params)) err('runtime.on_params', 'must be rerun or continue');
      if (rt.options !== undefined && !isObj(rt.options)) err('runtime.options', 'must be a mapping');
    }

    // ---- time ----
    const tm = m.time;
    if (!isObj(tm)) err('time', 'required: {unit: day, steps: 100}');
    else {
      for (const k of Object.keys(tm)) if (!['unit', 'steps', 'speeds', 'speed'].includes(k)) err('time.' + k, 'unknown key');
      if (!isStr(tm.unit)) err('time.unit', 'required: the name of one step, such as day or week');
      if (!isInt(tm.steps) || tm.steps < 1) err('time.steps', 'required: the number of steps in the horizon, at least 1');
      if (tm.speeds !== undefined && !(Array.isArray(tm.speeds) && tm.speeds.length && tm.speeds.every(s => isNum(s) && s > 0))) err('time.speeds', 'must be a list of positive numbers (steps per second)');
      if (tm.speed !== undefined && !(isNum(tm.speed) && tm.speed > 0)) err('time.speed', 'must be a positive number');
      if (Array.isArray(tm.speeds) && isNum(tm.speed) && !tm.speeds.includes(tm.speed)) warn('time.speed', 'is not in time.speeds');
    }

    // ---- params ----
    const params = isObj(m.params) ? m.params : {};
    if (m.params === undefined) err('params', 'required (it may be empty: {})'); else if (!isObj(m.params)) err('params', 'must be a mapping of name to definition');
    const groups = [];
    for (const [name, p] of Object.entries(params)) {
      const at = 'params.' + name;
      if (!NAME.test(name)) err(at, 'name must be lower-case letters, digits and underscores, starting with a letter');
      if (!isObj(p)) { err(at, 'must be a mapping'); continue; }
      for (const k of Object.keys(p)) if (!['type', 'min', 'max', 'step', 'default', 'values', 'unit', 'label', 'group', 'help'].includes(k)) err(at + '.' + k, 'unknown key');
      if (!PARAM_TYPES.includes(p.type)) { err(at + '.type', 'must be one of ' + PARAM_TYPES.join(', ')); continue; }
      for (const k of ['unit', 'label', 'group', 'help']) if (p[k] !== undefined && !isStr(p[k])) err(at + '.' + k, 'must be a non-empty string');
      if (p.group && !groups.includes(p.group)) groups.push(p.group);
      if (p.default === undefined) err(at + '.default', 'required');
      if (p.type === 'number' || p.type === 'integer') {
        if (!isNum(p.min) || !isNum(p.max)) err(at, 'a ' + p.type + ' needs min and max (they set the slider)');
        else if (!(p.min < p.max)) err(at, 'min must be below max');
        if (p.step !== undefined && !(isNum(p.step) && p.step > 0)) err(at + '.step', 'must be a positive number');
      } else {
        for (const k of ['min', 'max', 'step']) if (p[k] !== undefined) err(at + '.' + k, 'only numbers have ' + k);
      }
      if (p.type === 'enum') {
        const vs = Array.isArray(p.values) ? p.values : null;
        if (!vs || !vs.length) err(at + '.values', 'an enum needs a non-empty list of values');
        else {
          const names = enumValues(p);
          if (!names.every(isStr)) err(at + '.values', 'each value is a string or {value, label}');
          if (new Set(names).size !== names.length) err(at + '.values', 'values must be unique');
        }
      } else if (p.values !== undefined) err(at + '.values', 'only an enum has values');
      if (p.default !== undefined && !(p.type === 'enum' && !Array.isArray(p.values))) { const why = checkValue(p, p.default); if (why) err(at + '.default', why); }
      if (p.type === 'integer' && p.step !== undefined && !isInt(p.step)) err(at + '.step', 'must be whole for an integer');
    }

    // ---- presets ----
    if (m.presets !== undefined) {
      if (!Array.isArray(m.presets)) err('presets', 'must be a list');
      else {
        const seen = new Set();
        m.presets.forEach((pr, i) => {
          const at = 'presets[' + i + ']';
          if (!isObj(pr)) { err(at, 'must be a mapping'); return; }
          for (const k of Object.keys(pr)) if (!['id', 'label', 'params', 'help'].includes(k)) err(at + '.' + k, 'unknown key');
          if (!isStr(pr.id) || !SLUG.test(pr.id)) err(at + '.id', 'required: lower-case letters, digits and hyphens'); else if (seen.has(pr.id)) err(at + '.id', 'duplicate preset id ' + pr.id); else seen.add(pr.id);
          if (!isStr(pr.label)) err(at + '.label', 'required: the button text');
          if (!isObj(pr.params)) err(at + '.params', 'required: the parameter values this preset sets (it may be empty: {})');
          else for (const [k, v] of Object.entries(pr.params)) {
            if (!params[k]) err(at + '.params.' + k, 'unknown parameter'); else if (isObj(params[k]) && PARAM_TYPES.includes(params[k].type)) { const why = checkValue(params[k], v); if (why) err(at + '.params.' + k, why); }
          }
        });
      }
    }

    // ---- entities ----
    const ents = isObj(m.entities) ? m.entities : {};
    if (m.entities !== undefined && !isObj(m.entities)) err('entities', 'must be a mapping of name to definition');
    for (const [name, e] of Object.entries(ents)) {
      const at = 'entities.' + name;
      if (!NAME.test(name)) err(at, 'name must be lower-case letters, digits and underscores');
      if (!isObj(e)) { err(at, 'must be a mapping'); continue; }
      for (const k of Object.keys(e)) if (!['count', 'from', 'fields'].includes(k)) err(at + '.' + k, 'unknown key');
      if (e.count !== undefined && !(isInt(e.count) && e.count >= 1)) err(at + '.count', 'must be a whole number of at least 1');
      if (e.from !== undefined && e.from !== 'scene') err(at + '.from', 'must be "scene"');
      if (e.count === undefined && e.from === undefined) err(at, 'needs count (how many the model makes) or from: scene');
      if (!isObj(e.fields) || !keysOf(e.fields).length) { err(at + '.fields', 'required: at least one field'); continue; }
      for (const [fn, f] of Object.entries(e.fields)) {
        const fat = at + '.fields.' + fn;
        if (!NAME.test(fn)) err(fat, 'name must be lower-case letters, digits and underscores');
        const spec = typeof f === 'string' ? { type: f } : f;
        if (!isObj(spec)) { err(fat, 'must be a type name or a mapping'); continue; }
        for (const k of Object.keys(spec)) if (!['type', 'values', 'label'].includes(k)) err(fat + '.' + k, 'unknown key');
        if (!FIELD_TYPES.includes(spec.type)) { err(fat + '.type', 'must be one of ' + FIELD_TYPES.join(', ')); continue; }
        if (spec.type === 'category') {
          if (!Array.isArray(spec.values) || !spec.values.length || !spec.values.every(isStr)) err(fat + '.values', 'a category needs a non-empty list of names; the runtime sends the index into this list');
          else if (new Set(spec.values).size !== spec.values.length) err(fat + '.values', 'values must be unique');
        } else if (spec.values !== undefined) err(fat + '.values', 'only a category has values');
      }
    }
    const fieldSpec = (en, fn) => { const f = isObj(ents[en]) && isObj(ents[en].fields) ? ents[en].fields[fn] : undefined; return typeof f === 'string' ? { type: f } : f; };

    // ---- mappings ----
    if (m.mappings !== undefined && !Array.isArray(m.mappings)) err('mappings', 'must be a list');
    const maps = Array.isArray(m.mappings) ? m.mappings : [];
    maps.forEach((mp, i) => {
      const at = 'mappings[' + i + ']';
      if (!isObj(mp)) { err(at, 'must be a mapping'); return; }
      for (const k of Object.keys(mp)) if (!['entity', 'field', 'channel', 'scale', 'total', 'max', 'group', 'aggregate', 'opacity', 'colour', 'lod'].includes(k)) err(at + '.' + k, 'unknown key');
      if (mp.colour !== undefined) {                       // which surfaces of the building a wall mapping paints
        if (mp.channel !== 'wall') err(at + '.colour', 'only a wall mapping chooses its surfaces (wall, roof or wall+roof)');
        else if (!COLOUR_ON.includes(mp.colour)) err(at + '.colour', 'must be one of ' + COLOUR_ON.join(', '));
      }
      if (mp.lod !== undefined) {                          // level of detail of an outline or halo: from which scale a building is highlighted on its own, and what is drawn below it
        const l = mp.lod;
        if (mp.channel !== 'outline' && mp.channel !== 'halo') err(at + '.lod', 'only an outline or halo mapping has a level of detail');
        else if (!isObj(l)) err(at + '.lod', 'must be a mapping {min_scale, far, cell}');
        else {
          for (const k of Object.keys(l)) if (!['min_scale', 'far', 'cell'].includes(k)) err(at + '.lod.' + k, 'unknown key');
          if (l.min_scale !== undefined && !(isNum(l.min_scale) && l.min_scale >= 0 && l.min_scale <= 20)) err(at + '.lod.min_scale', 'must be a scale in pixels per metre from 0 to 20');
          if (l.far !== undefined && !LOD_FAR.includes(l.far)) err(at + '.lod.far', 'must be one of ' + LOD_FAR.join(', '));
          if (l.cell !== undefined && !(isNum(l.cell) && l.cell >= 20 && l.cell <= 1000)) err(at + '.lod.cell', 'must be a cell size in metres from 20 to 1000');
          if (l.far === 'show' && l.min_scale !== undefined) warn(at + '.lod.min_scale', 'ignored: far: show draws the highlight at every zoom');
        }
      }
      if (PLANNED_CHANNELS.includes(mp.channel)) { warn(at + '.channel', mp.channel + ' is a planned channel and is ignored for now'); return; }
      if (!CHANNELS.includes(mp.channel)) { err(at + '.channel', 'must be one of ' + CHANNELS.join(', ')); return; }
      const f = fieldSpec(mp.entity, mp.field);
      if (!isObj(ents[mp.entity])) { err(at + '.entity', 'unknown entity ' + mp.entity); return; }
      if (!isObj(f)) { err(at + '.field', 'entity ' + mp.entity + ' has no field ' + mp.field); return; }
      const sc = mp.scale;
      if (mp.channel === 'segments') {                // k of n units: the field holds k, mp.total names the field that holds n
        if (f.type === 'category') err(at + '.field', 'a segments channel needs a number or int field (units done), ' + mp.field + ' is a category');
        if (!isStr(mp.total)) err(at + '.total', 'required: the field that holds the number of units');
        else { const tf = fieldSpec(mp.entity, mp.total); if (!isObj(tf)) err(at + '.total', 'entity ' + mp.entity + ' has no field ' + mp.total); else if (tf.type === 'category') err(at + '.total', 'must be a number or int field, ' + mp.total + ' is a category'); }
        if (mp.max !== undefined && !(Number.isInteger(mp.max) && mp.max >= 2 && mp.max <= SEG_MAX)) err(at + '.max', 'must be a whole number from 2 to ' + SEG_MAX);
        if (!isObj(sc) || sc.type !== 'segments') { err(at + '.scale.type', 'must be segments'); return; }
        if (!(typeof sc.colour === 'string' && HEX.test(sc.colour))) err(at + '.scale.colour', 'needs a #rrggbb colour');
        if (sc.todo !== undefined && !(typeof sc.todo === 'string' && HEX.test(sc.todo))) err(at + '.scale.todo', 'must be a #rrggbb colour');
        if (!isStr(sc.label)) warn(at + '.scale.label', 'missing: the legend will show the field name');
        return;
      }
      if (mp.channel === 'groundtint') {              // the ground under the buildings, tinted by an aggregate of the field over a neighbourhood
        if (f.type === 'category') err(at + '.field', 'the groundtint channel needs a number, int or boolean field to aggregate, ' + mp.field + ' is a category');
        const gr = mp.group;
        if (!isObj(gr)) err(at + '.group', 'required: {grid: metres} or {field: name, cell: metres}');
        else {
          for (const k of Object.keys(gr)) if (!['grid', 'field', 'cell'].includes(k)) err(at + '.group.' + k, 'unknown key');
          if ((gr.grid === undefined) === (gr.field === undefined)) err(at + '.group', 'give either grid or field');
          else if (gr.grid !== undefined) { if (!(isNum(gr.grid) && gr.grid >= 10 && gr.grid <= 2000)) err(at + '.group.grid', 'must be a cell size in metres from 10 to 2000'); if (gr.cell !== undefined) err(at + '.group.cell', 'only with a field group'); }
          else {
            const gf = fieldSpec(mp.entity, gr.field);
            if (!isStr(gr.field) || !isObj(gf)) err(at + '.group.field', 'entity ' + mp.entity + ' has no field ' + gr.field);
            if (gr.cell !== undefined && !(isNum(gr.cell) && gr.cell >= 10 && gr.cell <= 500)) err(at + '.group.cell', 'must be a cell size in metres from 10 to 500');
          }
        }
        if (mp.aggregate !== undefined && !AGGREGATES.includes(mp.aggregate)) err(at + '.aggregate', 'must be one of ' + AGGREGATES.join(', '));
        if (mp.opacity !== undefined && !(isNum(mp.opacity) && mp.opacity > 0 && mp.opacity <= 1)) err(at + '.opacity', 'must be above 0 and at most 1');
        if (!isObj(sc) || sc.type !== 'sequential') { err(at + '.scale.type', 'the groundtint channel needs a sequential scale'); return; }
        if (!(Array.isArray(sc.domain) && sc.domain.length === 2 && sc.domain.every(isNum) && sc.domain[0] < sc.domain[1])) err(at + '.scale.domain', 'must be [low, high] with low below high');
        if (!(Array.isArray(sc.colours) && sc.colours.length >= 2 && sc.colours.every(c => typeof c === 'string' && HEX.test(c)))) err(at + '.scale.colours', 'must be at least two #rrggbb colours');
        if (!isStr(sc.label)) warn(at + '.scale.label', 'missing: the legend will show the field name');
        return;
      }
      if (!isObj(sc) || !['categorical', 'sequential'].includes(sc.type)) { err(at + '.scale.type', 'must be categorical or sequential'); return; }
      if (sc.type === 'sequential') {
        if (mp.channel !== 'wall') err(at, 'a sequential scale colours walls; ' + (mp.channel === 'overlay' ? 'an overlay' : 'the ' + mp.channel + ' channel') + ' needs a categorical scale');
        if (f.type === 'category') err(at, 'a sequential scale needs a number field, ' + mp.field + ' is a category');
        if (!(Array.isArray(sc.domain) && sc.domain.length === 2 && sc.domain.every(isNum) && sc.domain[0] < sc.domain[1])) err(at + '.scale.domain', 'must be [low, high] with low below high');
        if (!(Array.isArray(sc.colours) && sc.colours.length >= 2 && sc.colours.every(c => typeof c === 'string' && HEX.test(c)))) err(at + '.scale.colours', 'must be at least two #rrggbb colours');
        if (!isStr(sc.label)) warn(at + '.scale.label', 'missing: the legend will show the field name');
      } else {
        if (!isObj(sc.values) || !keysOf(sc.values).length) { err(at + '.scale.values', 'must map each value to its label and colour or overlay'); return; }
        const legal = f.type === 'category' ? f.values : f.type === 'boolean' ? ['true', 'false', '0', '1'] : null;
        for (const [k, v] of Object.entries(sc.values)) {
          const vat = at + '.scale.values.' + k;
          if (legal && Array.isArray(legal) && !legal.includes(k)) err(vat, 'not a value of ' + mp.entity + '.' + mp.field + ' (' + legal.join(', ') + ')');
          if (!isObj(v) || !isStr(v.label)) { err(vat, 'needs a label (the legend names it)'); continue; }
          if (mp.channel === 'wall' && !(typeof v.colour === 'string' && HEX.test(v.colour))) err(vat + '.colour', 'needs a #rrggbb colour');
          if ((mp.channel === 'outline' || mp.channel === 'halo') && v.colour !== null && v.colour !== undefined && !(typeof v.colour === 'string' && HEX.test(v.colour))) err(vat + '.colour', 'needs a #rrggbb colour, or null for no ' + mp.channel);
          if (mp.channel === 'overlay' && v.overlay !== null && v.overlay !== undefined && !OVERLAYS.includes(v.overlay)) err(vat + '.overlay', 'must be null or one of ' + OVERLAYS.join(', '));
        }
        if (f.type === 'category' && Array.isArray(f.values)) { const miss = f.values.filter(v => !(v in sc.values)); if (miss.length) warn(at + '.scale.values', 'no entry for ' + miss.join(', ') + ': ' + (mp.channel === 'wall' ? 'drawn as "no data"' : mp.channel === 'overlay' ? 'drawn with no marking' : 'drawn with no ' + mp.channel)); }
      }
    });
    if (maps.length === 0 && keysOf(ents).length) warn('mappings', 'none: nothing will be drawn on the map');

    // ---- series ----
    const series = isObj(m.series) ? m.series : {};
    if (m.series !== undefined && !isObj(m.series)) err('series', 'must be a mapping of name to definition');
    for (const [name, s] of Object.entries(series)) {
      const at = 'series.' + name;
      if (!NAME.test(name)) err(at, 'name must be lower-case letters, digits and underscores');
      if (!isObj(s)) { err(at, 'must be a mapping'); continue; }
      for (const k of Object.keys(s)) if (!['label', 'unit', 'x', 'y'].includes(k)) err(at + '.' + k, 'unknown key');
      if (!Array.isArray(s.y) || !s.y.length || !s.y.every(isStr) || new Set(s.y).size !== s.y.length) err(at + '.y', 'required: a list of unique names, one per value in each point');
      for (const k of ['label', 'unit', 'x']) if (s[k] !== undefined && !isStr(s[k])) err(at + '.' + k, 'must be a non-empty string');
    }

    // ---- layout ----
    if (m.layout !== undefined) {
      if (!isObj(m.layout)) err('layout', 'must be a mapping of region to a list of components');
      else for (const [region, items] of Object.entries(m.layout)) {
        const at = 'layout.' + region;
        if (region === 'inspector') { warn(at, 'the inspector is planned and is ignored for now'); continue; }
        if (!REGIONS.includes(region)) { err(at, 'unknown region (left, right, bottom)'); continue; }
        if (!Array.isArray(items)) { err(at, 'must be a list'); continue; }
        items.forEach((it, i) => {
          const iat = at + '[' + i + ']';
          if (!isObj(it)) { err(iat, 'must be a mapping'); return; }
          const kind = ITEM_KINDS.filter(k => it[k] !== undefined);
          if (kind.length !== 1) { err(iat, 'needs exactly one of control, chart, kpis, table'); return; }
          for (const k of Object.keys(it)) if (!ITEM_KEYS[kind[0]].includes(k)) err(iat + '.' + k, 'unknown key for a ' + kind[0] + ' component');
          if (kind[0] === 'chart') {
            if (!CHART_TYPES.includes(it.chart)) err(iat + '.chart', 'must be one of ' + CHART_TYPES.join(', '));
            const sr = isStr(it.series) ? series[it.series] : undefined;
            if (!isStr(it.series)) err(iat + '.series', 'required: the series to draw'); else if (!sr) err(iat + '.series', 'unknown series ' + it.series);
            if (it.y !== undefined) {
              if (!Array.isArray(it.y) || !it.y.length || !it.y.every(isStr) || new Set(it.y).size !== it.y.length) err(iat + '.y', 'must be a list of unique value names from the series');
              else if (sr && Array.isArray(sr.y)) for (const n of it.y) if (!sr.y.includes(n)) err(iat + '.y', 'no value ' + n + ' in series ' + it.series + ' (' + sr.y.join(', ') + ')');
            }
            for (const k of ['title', 'unit', 'x']) if (it[k] !== undefined && !isStr(it[k])) err(iat + '.' + k, 'must be a non-empty string');
            if (it.compare !== undefined && typeof it.compare !== 'boolean') err(iat + '.compare', 'must be true or false');
            return;
          }
          if (kind[0] === 'kpis') {
            if (it.title !== undefined && !isStr(it.title)) err(iat + '.title', 'must be a non-empty string');
            if (!Array.isArray(it.kpis) || !it.kpis.length) { err(iat + '.kpis', 'must be a non-empty list of tiles'); return; }
            it.kpis.forEach((k, j) => {
              const kat = iat + '.kpis[' + j + ']';
              if (!isObj(k)) { err(kat, 'must be a mapping'); return; }
              for (const key of Object.keys(k)) if (!['label', 'series', 'y', 'at', 'unit', 'decimals'].includes(key)) err(kat + '.' + key, 'unknown key');
              if (!isStr(k.label)) err(kat + '.label', 'required: the tile text');
              const sr = isStr(k.series) ? series[k.series] : undefined;
              if (!isStr(k.series)) err(kat + '.series', 'required'); else if (!sr) err(kat + '.series', 'unknown series ' + k.series);
              if (k.y !== undefined && !isStr(k.y)) err(kat + '.y', 'must be a value name from the series');
              else if (sr && Array.isArray(sr.y)) { if (k.y === undefined && sr.y.length > 1) err(kat + '.y', 'required: series ' + k.series + ' has several values (' + sr.y.join(', ') + ')'); else if (k.y !== undefined && !sr.y.includes(k.y)) err(kat + '.y', 'no value ' + k.y + ' in series ' + k.series + ' (' + sr.y.join(', ') + ')'); }
              if (k.at !== undefined && !KPI_AT.includes(k.at)) err(kat + '.at', 'must be one of ' + KPI_AT.join(', '));
              if (k.unit !== undefined && !isStr(k.unit)) err(kat + '.unit', 'must be a non-empty string');
              if (k.decimals !== undefined && !(isInt(k.decimals) && k.decimals >= 0 && k.decimals <= 6)) err(kat + '.decimals', 'must be a whole number from 0 to 6');
            });
            return;
          }
          if (kind[0] !== 'control') { warn(iat, kind[0] + ' components are planned and are not drawn yet'); if (it.series !== undefined && !series[it.series]) err(iat + '.series', 'unknown series ' + it.series); return; }
          if (!CONTROLS.includes(it.control)) { err(iat + '.control', 'must be one of ' + CONTROLS.join(', ')); return; }
          if (it.groups !== undefined) {
            if (it.control !== 'params') err(iat + '.groups', 'only the params control has groups');
            else if (!Array.isArray(it.groups)) err(iat + '.groups', 'must be a list of group names');
            else for (const g of it.groups) if (!groups.includes(g)) err(iat + '.groups', 'no parameter is in group ' + g + ' (groups: ' + (groups.join(', ') || 'none') + ')');
          }
          if (it.items !== undefined) {
            if (it.control !== 'display') err(iat + '.items', 'only the display control has items');
            else if (!Array.isArray(it.items) || new Set(it.items).size !== it.items.length) err(iat + '.items', 'must be a list of unique switch names (' + DISPLAY_IDS.join(', ') + ')');
            else for (const n of it.items) if (!DISPLAY_IDS.includes(n)) err(iat + '.items', 'unknown switch ' + n + ' (' + DISPLAY_IDS.join(', ') + ')');
          }
        });
      }
    }
    if (m.banner !== undefined && typeof m.banner !== 'string') err('banner', 'must be a string');
    if (!m.banner) warn('banner', 'none: say where the geometry and the data come from');
    return { ok: errors.length === 0, errors, warnings };
  }

  root.PackSpec = { validate, checkValue, enumValues, CHANNELS, OVERLAYS, CHART_TYPES, DISPLAY_IDS, KPI_AT };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackSpec;
})(typeof window !== 'undefined' ? window : globalThis);
